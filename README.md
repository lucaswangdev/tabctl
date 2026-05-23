# ⎈ tabctl

> kubectl for your browser tabs — namespace, label, and rollout tabs like Kubernetes pods.

## Architecture

```
Chrome Extension (Manifest V3, React + TypeScript)
        │  HTTP REST
        ▼
tabctl-server (localhost:7420, Rust + Axum)
        │  SQLite
        ▼
~/.tabctl/tabctl.db   ← single source of truth
```

## Quick Start

### Prerequisites

- **Rust** (latest stable) — install via [rustup](https://rustup.rs/)
- **Chrome** browser (for extension)

#### ⚠️ Cargo 镜像加速（如遇卡顿）

如果 `cargo build` 卡在 `Updating tuna index`，说明清华 tuna 镜像连接慢。解决方法：

```bash
mv ~/.cargo/config ~/.cargo/config.bak
cargo build --release -p tabctl-server
```

构建完成后如需恢复镜像：
```bash
mv ~/.cargo/config.bak ~/.cargo/config
```

---

### 1. Start the local server

```bash
./start.sh      # one-click: install + build server & extension + start server
```

Or manually:

```bash
# Rust server (recommended)
cargo build --release -p tabctl-server
./server-rs/target/release/tabctl-server

# Or from server-rs/ directory:
cd server-rs && cargo run --release

# Server runs at http://localhost:7420
# Data stored at ~/.tabctl/tabctl.db (override with TABCTL_DB env var)
```

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
| PUT | `/api/pods/{id}` | Update pod |
| DELETE | `/api/pods/{id}` | Delete pod |
| POST | `/api/pods/batch` | Batch create pods |
| GET | `/api/deployments` | List deployments |
| POST | `/api/deployments` | Create deployment |
| DELETE | `/api/deployments/{id}` | Delete deployment |
| GET | `/api/deployments/{id}/pods` | Get pods matching deployment |
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
├── server-rs/               # Rust server (recommended)
│   ├── src/
│   │   ├── main.rs         # Entry point
│   │   ├── handlers.rs     # HTTP handlers
│   │   ├── db.rs           # SQLite data layer
│   │   ├── schema.rs       # Type definitions
│   │   ├── state.rs        # AppState
│   │   ├── error.rs        # Error types
│   │   └── backup.rs       # DB backup utilities
│   └── Cargo.toml
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
# Rust server
cd server-rs
cargo build --release        # Build
cargo run --release          # Run
cargo test                   # Run tests

# Extension
cd extension
npm run build   # Vite production build → dist/
npm run dev     # Vite dev server (for testing)
```

---

## Auto-start server on Mac login (optional)

### Run in background (手动后台运行)

```bash
nohup /full/path/to/tabctl/server-rs/target/release/tabctl-server > /tmp/tabctl.log 2>&1 &
disown
```

或用相对路径（从项目根目录）：

```bash
nohup ./server-rs/target/release/tabctl-server > /tmp/tabctl.log 2>&1 &
disown
```

### Via LaunchAgent (开机自启动)

创建 `~/Library/LaunchAgents/com.tabctl.server.plist`（注意：修改下面的路径为你的实际路径）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.tabctl.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/Users/lucaswang/Data/github/tabctl/server-rs/target/release/tabctl-server</string>
    <!-- ↑ 改为你的 tabctl-server 实际路径 -->
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/lucaswang/Data/github/tabctl</string>
  <!-- ↑ 改为你的 tabctl 项目根目录 -->
  <key>StandardOutPath</key>
  <string>/tmp/tabctl.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/tabctl.log</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
</dict>
</plist>
```

路径修改说明：

| 配置项 | 示例路径 | 说明 |
|--------|----------|------|
| `ProgramArguments` | `/Users/lucaswang/Data/github/tabctl/server-rs/target/release/tabctl-server` | 编译后的可执行文件完整路径 |
| `WorkingDirectory` | `/Users/lucaswang/Data/github/tabctl` | 项目根目录（`start.sh` 所在目录） |

获取实际路径的方法：

```bash
# tabctl-server 路径
ls ~/Data/github/tabctl/server-rs/target/release/tabctl-server

# 项目根目录
pwd  # 在 tabctl 项目内执行
```

然后加载（已为你配置好）：

```bash
launchctl load ~/Library/LaunchAgents/com.tabctl.server.plist
```

验证是否运行：

```bash
launchctl list | grep tabctl
```

停止服务：

```bash
launchctl unload ~/Library/LaunchAgents/com.tabctl.server.plist
```