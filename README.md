# CodeAlpha - Project Management Tool

Trello/Asana-like collaborative project management tool.

## Features
- User authentication (register/login)
- Create group projects
- Add members to projects
- Create and assign tasks
- Three-column Kanban board (To Do / In Progress / Done)
- Comment on tasks
- Real-time updates via WebSockets (socket.io) — tasks created/updated appear live

## Tech Stack
- Backend: Node.js + Express + socket.io
- Database: SQLite (better-sqlite3)
- Views: EJS

## Run
```bash
npm install
npm start
```
Open http://localhost:3002

## Author
Built for CodeAlpha Internship.
