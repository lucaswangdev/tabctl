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

## Data Management

数据库位置：`~/.tabctl/tabctl.db`（可通过 `TABCTL_DB` 环境变量覆盖）

### 数据库表结构

| 表名 | 用途 | 说明 |
|------|------|------|
| `pods` | 标签页 | 存储所有保存的标签页（name、url、namespace、labels 等） |
| `namespaces` | 命名空间 | 标签页分组（如 work、personal、research） |
| `deployments` | 部署配置 | 按 selector 规则动态匹配的 pod 集合 |

### 表关系

```
namespaces (1) ----< (N) pods
namespaces (1) ----< (N) deployments

deployments 与 pods：无直接外键关联，通过 selector 标签匹配
```

**关联说明**：

| 关系 | 说明 |
|------|------|
| `namespaces → pods` | 一对多：`pods.namespace` 外键 → `namespaces.id` |
| `namespaces → deployments` | 一对多：`deployments.namespace` 外键 → `namespaces.id` |
| `deployments → pods` | 无直接外键，通过 `labels` JSON 字段匹配 |

例如：一个 `work` namespace 下有多个 pods，也可以有多个 deployments。deployment 通过 `selector`（JSON 标签选择器）动态查找匹配的 pods，而不是直接存储 pod IDs。

### 查看数据（命令行）

```bash
# 查看所有表
sqlite3 ~/.tabctl/tabctl.db ".tables"

# 查看表结构
sqlite3 ~/.tabctl/tabctl.db ".schema pods"
sqlite3 ~/.tabctl/tabctl.db ".schema namespaces"
sqlite3 ~/.tabctl/tabctl.db ".schema deployments"

# 查看所有 pods
sqlite3 ~/.tabctl/tabctl.db "SELECT * FROM pods;"

# 查看所有 namespaces
sqlite3 ~/.tabctl/tabctl.db "SELECT * FROM namespaces;"

# 按 namespace 过滤查询
sqlite3 ~/.tabctl/tabctl.db "SELECT * FROM pods WHERE namespace='work';"

# 统计记录数
sqlite3 ~/.tabctl/tabctl.db "SELECT COUNT(*) FROM pods;"

# 格式化输出（列对齐）
sqlite3 -column -header ~/.tabctl/tabctl.db "SELECT id, name, url, namespace FROM pods;"
```

### 常用 SQL 示例

```bash
# 搜索包含关键字的 pod
sqlite3 ~/.tabctl/tabctl.db "SELECT * FROM pods WHERE name LIKE '%github%';"

# 删除指定 pod
sqlite3 ~/.tabctl/tabctl.db "DELETE FROM pods WHERE id='pod-xxx';"

# 导出为 JSON（通过 API）
curl http://localhost:7420/api/export > tabctl-backup.json

# 导入数据（通过 API）
curl -X POST http://localhost:7420/api/import -d @tabctl-backup.json -H "Content-Type: application/json"
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