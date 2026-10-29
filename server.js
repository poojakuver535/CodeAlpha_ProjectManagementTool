// CodeAlpha - Project Management Tool (Trello-like)
// Features: projects, task cards, assignments, comments, WebSocket real-time updates

const express = require('express');
const http = require('http');
const session = require('express-session');
const bodyParser = require('body-parser');
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const PORT = process.env.PORT || 3002;

const db = new Database('pm.db');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    owner_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT DEFAULT 'todo',
    assigned_to INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({ secret: 'codealpha-pm', resave: false, saveUninitialized: true }));

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  next();
});

function requireLogin(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

// Auth
app.get('/register', (req, res) => res.render('register', { error: null }));
app.post('/register', (req, res) => {
  try {
    const hash = bcrypt.hashSync(req.body.password, 10);
    db.prepare('INSERT INTO users (username, email, password) VALUES (?,?,?)').run(req.body.username, req.body.email, hash);
    res.redirect('/login');
  } catch { res.render('register', { error: 'Already exists.' }); }
});
app.get('/login', (req, res) => res.render('login', { error: null }));
app.post('/login', (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(req.body.email);
  if (!u || !bcrypt.compareSync(req.body.password, u.password)) return res.render('login', { error: 'Invalid' });
  req.session.user = { id: u.id, username: u.username };
  res.redirect('/');
});
app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

// Dashboard
app.get('/', requireLogin, (req, res) => {
  const projects = db.prepare(`
    SELECT DISTINCT p.* FROM projects p
    LEFT JOIN project_members pm ON pm.project_id=p.id
    WHERE p.owner_id=? OR pm.user_id=?`).all(req.session.user.id, req.session.user.id);
  res.render('dashboard', { projects });
});

app.post('/project', requireLogin, (req, res) => {
  const info = db.prepare('INSERT INTO projects (name, description, owner_id) VALUES (?,?,?)').run(req.body.name, req.body.description || '', req.session.user.id);
  db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?,?)').run(info.lastInsertRowid, req.session.user.id);
  res.redirect('/project/' + info.lastInsertRowid);
});

// Project board
app.get('/project/:id', requireLogin, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=?').get(req.params.id);
  if (!project) return res.status(404).send('Not found');
  const tasks = db.prepare(`
    SELECT t.*, u.username AS assignee FROM tasks t
    LEFT JOIN users u ON u.id=t.assigned_to
    WHERE project_id=?`).all(req.params.id);
  const members = db.prepare(`
    SELECT u.* FROM users u JOIN project_members pm ON pm.user_id=u.id
    WHERE pm.project_id=?`).all(req.params.id);
  const allUsers = db.prepare('SELECT * FROM users').all();
  res.render('board', { project, tasks, members, allUsers });
});

app.post('/project/:id/member', requireLogin, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username);
  if (u) {
    try { db.prepare('INSERT INTO project_members (project_id, user_id) VALUES (?,?)').run(req.params.id, u.id); } catch {}
  }
  res.redirect('/project/' + req.params.id);
});

app.post('/project/:id/task', requireLogin, (req, res) => {
  const info = db.prepare('INSERT INTO tasks (project_id, title, description, assigned_to) VALUES (?,?,?,?)').run(
    req.params.id, req.body.title, req.body.description || '', req.body.assigned_to || null
  );
  io.to('project-' + req.params.id).emit('task-created', { id: info.lastInsertRowid });
  res.redirect('/project/' + req.params.id);
});

app.post('/task/:id/status', requireLogin, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  db.prepare('UPDATE tasks SET status=? WHERE id=?').run(req.body.status, req.params.id);
  io.to('project-' + task.project_id).emit('task-updated', { id: req.params.id });
  res.redirect('/task/' + req.params.id);
});

app.get('/task/:id', requireLogin, (req, res) => {
  const task = db.prepare(`SELECT t.*, u.username AS assignee FROM tasks t LEFT JOIN users u ON u.id=t.assigned_to WHERE t.id=?`).get(req.params.id);
  if (!task) return res.status(404).send('Not found');
  const comments = db.prepare(`SELECT c.*, u.username FROM task_comments c JOIN users u ON u.id=c.user_id WHERE task_id=? ORDER BY created_at`).all(req.params.id);
  res.render('task', { task, comments });
});

app.post('/task/:id/comment', requireLogin, (req, res) => {
  const task = db.prepare('SELECT * FROM tasks WHERE id=?').get(req.params.id);
  db.prepare('INSERT INTO task_comments (task_id, user_id, content) VALUES (?,?,?)').run(req.params.id, req.session.user.id, req.body.content);
  io.to('project-' + task.project_id).emit('task-updated', { id: req.params.id });
  res.redirect('/task/' + req.params.id);
});

io.on('connection', (socket) => {
  socket.on('join-project', (projectId) => socket.join('project-' + projectId));
});

server.listen(PORT, () => console.log(`PM tool running on http://localhost:${PORT}`));
