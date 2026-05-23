//! Database layer with SQLite via rusqlite
//!
//! Performance optimizations:
//!   - WAL mode for concurrent reads
//!   - In-memory temp store
//!   - 64MB cache
//!   - Batch transactions for bulk inserts

use crate::backup::backup_existing_db;
use crate::schema::{DbStats, Deployment, Namespace, Pod};
use rusqlite::{params, Connection, Result as SqliteResult};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub struct Database {
    conn: Mutex<Connection>,
    path: PathBuf,
}

impl Database {
    pub fn new(path: impl Into<PathBuf>) -> SqliteResult<Self> {
        let path = path.into();

        // Backup existing database if present
        if path.exists() {
            if let Err(e) = backup_existing_db(&path) {
                eprintln!("⚠️  Failed to backup existing database: {}", e);
            }
        }

        let conn = Connection::open(&path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = OFF;
             PRAGMA synchronous = NORMAL;
             PRAGMA cache_size = -64000;
             PRAGMA temp_store = MEMORY;",
        )?;

        let db = Self {
            conn: Mutex::new(conn),
            path,
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS namespaces (
                id TEXT PRIMARY KEY,
                label TEXT NOT NULL,
                color TEXT,
                created_at TEXT DEFAULT (datetime('now'))
            );

            CREATE TABLE IF NOT EXISTS pods (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                url TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'work',
                labels TEXT DEFAULT '{}',
                status TEXT DEFAULT 'Saved',
                created_at TEXT DEFAULT (datetime('now')),
                updated_at TEXT,
                FOREIGN KEY (namespace) REFERENCES namespaces(id)
            );

            CREATE TABLE IF NOT EXISTS deployments (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                namespace TEXT NOT NULL,
                selector TEXT DEFAULT '{}',
                created_at TEXT DEFAULT (datetime('now')),
                FOREIGN KEY (namespace) REFERENCES namespaces(id)
            );

            CREATE INDEX IF NOT EXISTS idx_pods_namespace ON pods(namespace);
            CREATE INDEX IF NOT EXISTS idx_pods_url ON pods(url);
            CREATE INDEX IF NOT EXISTS idx_pods_created ON pods(created_at);
            CREATE INDEX IF NOT EXISTS idx_deployments_namespace ON deployments(namespace);
            CREATE INDEX IF NOT EXISTS idx_deployments_created ON deployments(created_at);",
        )?;
        Ok(())
    }

    // ── Pods ─────────────────────────────────────────────────────────────────

    pub fn list_pods(&self, namespace: Option<&str>) -> SqliteResult<Vec<Pod>> {
        let conn = self.conn.lock().unwrap();
        let pods: Vec<Pod> = if let Some(ns) = namespace {
            conn.prepare("SELECT * FROM pods WHERE namespace = ? ORDER BY created_at DESC")?
                .query_map(params![ns], |row| Ok(Pod::from_row(row)))?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare("SELECT * FROM pods ORDER BY created_at DESC")?
                .query_map([], |row| Ok(Pod::from_row(row)))?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(pods)
    }

    pub fn get_pod(&self, id: &str) -> SqliteResult<Option<Pod>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM pods WHERE id = ?")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Pod::from_row(row)))
        } else {
            Ok(None)
        }
    }

    pub fn create_pod(&self, pod: &Pod) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO pods (id, name, url, namespace, labels, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                pod.id,
                pod.name,
                pod.url,
                pod.namespace,
                serde_json::to_string(&pod.labels).unwrap_or_default(),
                pod.status.as_deref().unwrap_or("Saved"),
                pod.created_at.as_deref().unwrap_or_else(|| {
                    chrono::Utc::now().to_rfc3339().leak()
                }),
            ],
        )?;
        Ok(())
    }

    pub fn update_pod(&self, id: &str, patch: &Pod) -> SqliteResult<Option<Pod>> {
        let conn = self.conn.lock().unwrap();
        let updated = chrono::Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE pods SET name = ?1, url = ?2, namespace = ?3,
             labels = ?4, status = ?5, updated_at = ?6 WHERE id = ?7",
            params![
                patch.name,
                patch.url,
                patch.namespace,
                serde_json::to_string(&patch.labels).unwrap_or_default(),
                patch.status.as_deref().unwrap_or("Saved"),
                updated,
                id,
            ],
        )?;
        drop(conn);
        self.get_pod(id)
    }

    pub fn delete_pod(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM pods WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn upsert_pod(&self, pod: &Pod) -> SqliteResult<(String, bool)> {
        let conn = self.conn.lock().unwrap();
        let existing: Option<String> = conn
            .query_row(
                "SELECT id FROM pods WHERE url = ? AND namespace = ?",
                params![pod.url, pod.namespace],
                |row| row.get(0),
            )
            .ok();
        if let Some(id) = existing {
            return Ok((id, true)); // skipped
        }
        drop(conn);
        self.create_pod(pod)?;
        Ok((pod.id.clone(), false))
    }

    // ── Deployments ──────────────────────────────────────────────────────────

    pub fn list_deployments(&self, namespace: Option<&str>) -> SqliteResult<Vec<Deployment>> {
        let conn = self.conn.lock().unwrap();
        let deps: Vec<Deployment> = if let Some(ns) = namespace {
            conn.prepare("SELECT * FROM deployments WHERE namespace = ? ORDER BY created_at DESC")?
                .query_map(params![ns], |row| Ok(Deployment::from_row(row)))?
                .collect::<Result<Vec<_>, _>>()?
        } else {
            conn.prepare("SELECT * FROM deployments ORDER BY created_at DESC")?
                .query_map([], |row| Ok(Deployment::from_row(row)))?
                .collect::<Result<Vec<_>, _>>()?
        };
        Ok(deps)
    }

    pub fn create_deployment(&self, dep: &Deployment) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO deployments (id, name, namespace, selector, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                dep.id,
                dep.name,
                dep.namespace,
                serde_json::to_string(&dep.selector).unwrap_or_default(),
                dep.created_at.as_deref().unwrap_or_else(|| {
                    chrono::Utc::now().to_rfc3339().leak()
                }),
            ],
        )?;
        Ok(())
    }

    pub fn delete_deployment(&self, id: &str) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM deployments WHERE id = ?", params![id])?;
        Ok(())
    }

    pub fn get_deployment(&self, id: &str) -> SqliteResult<Option<Deployment>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT * FROM deployments WHERE id = ?")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(Deployment::from_row(row)))
        } else {
            Ok(None)
        }
    }

    pub fn get_deployment_selector(&self, id: &str) -> SqliteResult<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT selector FROM deployments WHERE id = ?")?;
        let mut rows = stmt.query(params![id])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }

    // ── Namespaces ───────────────────────────────────────────────────────────

    pub fn list_namespaces(&self) -> SqliteResult<Vec<Namespace>> {
        let conn = self.conn.lock().unwrap();
        let namespaces: Vec<Namespace> = conn
            .prepare("SELECT * FROM namespaces ORDER BY created_at ASC")?
            .query_map([], |row| Ok(Namespace::from_row(row)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(namespaces)
    }

    pub fn create_namespace(&self, ns: &Namespace) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO namespaces (id, label, color) VALUES (?1, ?2, ?3)",
            params![ns.id, ns.label, ns.color],
        )?;
        Ok(())
    }

    // ── Stats ───────────────────────────────────────────────────────────────

    pub fn get_stats(&self) -> SqliteResult<DbStats> {
        let conn = self.conn.lock().unwrap();
        let pods: i64 = conn.query_row("SELECT COUNT(*) FROM pods", [], |r| r.get(0))?;
        let namespaces: i64 =
            conn.query_row("SELECT COUNT(*) FROM namespaces", [], |r| r.get(0))?;
        let deployments: i64 =
            conn.query_row("SELECT COUNT(*) FROM deployments", [], |r| r.get(0))?;
        Ok(DbStats {
            pods: pods as usize,
            namespaces: namespaces as usize,
            deployments: deployments as usize,
        })
    }

    // ── Batch operations ─────────────────────────────────────────────────────

    pub fn batch_create_pods(&self, pods: &[Pod]) -> SqliteResult<(usize, usize)> {
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        let mut stmt = tx.prepare(
            "INSERT INTO pods (id, name, url, namespace, labels, status, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )?;

        let mut created = 0;
        let mut errors = 0;
        for pod in pods {
            match stmt.execute(params![
                pod.id,
                pod.name,
                pod.url,
                pod.namespace,
                serde_json::to_string(&pod.labels).unwrap_or_default(),
                pod.status.as_deref().unwrap_or("Saved"),
                pod.created_at.as_deref().unwrap_or_else(|| {
                    chrono::Utc::now().to_rfc3339().leak()
                }),
            ]) {
                Ok(_) => created += 1,
                Err(_) => errors += 1,
            }
        }
        drop(stmt);
        tx.commit()?;
        Ok((created, errors))
    }

    // ── Import/Export ────────────────────────────────────────────────────────

    pub fn export_all(&self) -> SqliteResult<(Vec<Pod>, Vec<Deployment>, Vec<Namespace>)> {
        let pods = self.list_pods(None)?;
        let deployments = self.list_deployments(None)?;
        let namespaces = self.list_namespaces()?;
        Ok((pods, deployments, namespaces))
    }

    pub fn clear_all(&self) -> SqliteResult<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch("DELETE FROM pods; DELETE FROM deployments; DELETE FROM namespaces;")?;
        Ok(())
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
}