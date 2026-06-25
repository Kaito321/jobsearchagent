# Job Application Agent

A local React app with SQLite storage for managing AI-powered job applications.

## Setup

1. **Install dependencies**
   ```
   npm install
   ```

2. **Start the app**
   ```
   npm run dev
   ```
   This starts both the frontend (port 5173) and backend server (port 3001).

3. **Open in Chrome**
   ```
   http://localhost:5173
   ```

## Requirements

- Node.js (already installed)
- Claude in Chrome extension (for browser automation)

## Your data

All data is stored permanently in `jobagent.db` in this folder.
- Back it up by copying `jobagent.db` anywhere you like
- Export as JSON from the Settings page

## Cover letter folder

Set your cover letter save folder in the Dashboard sidebar.
Files are named: `CompanyName_MMDDYY_CL.pdf` or `AAA_MMDDYY_CL.pdf`

## Project structure

```
jobagent/
├── server/
│   └── index.js        ← Express + SQLite backend
├── src/
│   ├── pages/
│   │   ├── Dashboard.jsx   ← Main agent control center
│   │   ├── History.jsx     ← All past sessions & jobs
│   │   └── Settings.jsx    ← Config & data management
│   ├── components/
│   │   └── UI.jsx          ← Shared components
│   ├── api.js              ← API helper functions
│   └── App.jsx             ← App shell & navigation
├── jobagent.db         ← Your database (created on first run)
└── package.json
```
