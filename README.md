# ⎈ tabctl

> kubectl for your browser tabs — namespace, label, and rollout tabs like Kubernetes pods.

## Architecture

```
Chrome Extension (Manifest V3, React + TypeScript)
        │  HTTP REST
        ▼
tabctl-server (localhost:7420, Express + TypeScript)
        │  SQLite
        ▼
tabctl.db   ← single source of truth
```

## Quick Start

### 1. Start the local server

```bash
./start.sh      # one-click: install + build server & extension + start server
```

Server runs at `http://localhost:7420`
Data is stored at `./server/tabctl.db`

### 2. Load the Chrome Extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/dist/` folder

---

## Features

### Tab 1 — Current Window Tabs
- View all open tabs in the current Chrome window
- Fuzzy search by title or URL
- **▶ open all** — open all current tabs at once
- **✕ close all** — close all current window tabs
- **☆** — add any tab to a favorites namespace

### Tab 2 — Favorites (Namespaces)
- Namespaces: work, research, personal, ops (built-in) + custom namespaces
- Create new namespaces, delete namespaces
- **⊞ expand all / ⊟ collapse all** — expand or collapse all namespace groups
- **▶** open all tabs in a namespace
- **✕** close all tabs in a namespace (closes current window tabs)
- **🗑** delete entire namespace group
- Per-item **↗ open** and **✕ delete**
- Import Chrome bookmarks HTML file
- Fuzzy search across all favorites

---

## REST API

| Method | Path | Description |
|--------|------|-------------|
| GET | `/health` | Server health check |
| GET | `/api/pods` | List pods (filter: `?namespace=work&label=team=infra`) |
| POST | `/api/pods` | Create pod |
| PUT | `/api/pods/:id` | Update pod |
| DELETE | `/api/pods/:id` | Delete pod |
| POST | `/api/pods/batch` | Batch create pods |
| GET | `/api/deployments` | List deployments |
| POST | `/api/deployments` | Create deployment |
| DELETE | `/api/deployments/:id` | Delete deployment |
| GET | `/api/deployments/:id/pods` | Get pods matching deployment |
| GET | `/api/namespaces` | List custom namespaces |
| POST | `/api/namespaces` | Create namespace |
| GET | `/api/export` | Download full data as JSON |
| POST | `/api/import` | Import JSON (merge or replace) |
| POST | `/api/import/bookmarks` | Import Chrome bookmarks HTML |

---

## Pod Format

```json
{
  "id": "pod-abc123",
  "name": "github-prs",
  "namespace": "work",
  "url": "https://github.com/pulls",
  "labels": { "env": "prod", "team": "infra" },
  "status": "Saved",
  "createdAt": "2026-04-26T09:00:00Z"
}
```

---

## Project Structure

```
tabctl/
├── README.md
├── server/
│   ├── server.ts          # Express REST API (TypeScript)
│   ├── db.ts              # SQLite data layer (TypeScript)
│   ├── dist/              # Compiled JS output
│   ├── tabctl.db          # SQLite database
│   ├── tsconfig.json
│   └── package.json
└── extension/
    ├── dist/              # Built extension (load this in Chrome)
    ├── public/            # Static assets (background.js, icons)
    ├── src/
    │   ├── App.tsx        # Main React popup UI (TypeScript)
    │   ├── api.ts         # Typed API client (TypeScript)
    │   ├── types.ts       # Shared type definitions (TypeScript)
    │   └── main.jsx       # React entry point
    ├── manifest.json
    ├── vite.config.js
    └── package.json
```

---

## Development

```bash
# Server
cd server
npm run dev     # ts-node, hot reload
npm run build  # compile TypeScript → dist/

# Extension
cd extension
npm run build   # Vite production build → dist/
npm run dev     # Vite dev server (for testing)
```

---

## Auto-start server on Mac login (optional)

### Run in background

```bash
cd server
nohup node dist/server.js > /tmp/tabctl.log 2>&1 &
disown
```

### Auto-start via LaunchAgent

Create `~/Library/LaunchAgents/com.tabctl.server.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"...">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.tabctl.server</string>
  <key>ProgramArguments</key>
  <array><string>/usr/local/bin/node</string><string>/path/to/tabctl/server/dist/server.js</string></array>
  <key>WorkingDirectory</key><string>/path/to/tabctl/server</string>
  <key>RunAtLoad</key><true/>
</dict>
</plist>
```

Then load it:

```bash
launchctl load ~/Library/LaunchAgents/com.tabctl.server.plist
```
