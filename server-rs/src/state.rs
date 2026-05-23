//! Application state

use crate::db::Database;
use crate::error::AppError;
use crate::schema::{DbStats, Deployment, Namespace, Pod};
use std::path::PathBuf;
use std::sync::Arc;

pub struct AppState {
    pub db: Arc<Database>,
    db_path: PathBuf,
}

impl AppState {
    pub async fn new() -> Result<Self, AppError> {
        let db_path = std::env::var("TABCTL_DB")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                dirs::data_local_dir()
                    .unwrap_or_else(|| PathBuf::from("."))
                    .join("tabctl.db")
            });

        let db = Arc::new(Database::new(&db_path)?);
        Ok(Self { db, db_path })
    }

    pub fn db_path(&self) -> &PathBuf {
        &self.db_path
    }

    pub fn get_stats(&self) -> Result<DbStats, AppError> {
        Ok(self.db.get_stats()?)
    }

    pub fn migrate_from_json(&self) -> Result<(), AppError> {
        let data_file = std::env::var("TABCTL_DATA")
            .map(PathBuf::from)
            .unwrap_or_else(|_| {
                std::env::current_dir()
                    .unwrap_or_else(|_| PathBuf::from("."))
                    .join("data.json")
            });

        if !data_file.exists() {
            return Ok(());
        }

        // Check if already migrated
        if self.db.list_namespaces()?.len() > 0 {
            tracing::info!("✅ SQLite already initialized, skipping migration");
            return Ok(());
        }

        let json_content = std::fs::read_to_string(&data_file)
            .map_err(|e| AppError::Internal(e.to_string()))?;
        let json: serde_json::Value = serde_json::from_str(&json_content)
            .map_err(|e| AppError::Internal(e.to_string()))?;

        // Migrate namespaces
        if let Some(ns) = json.get("namespaces").and_then(|v| v.as_array()) {
            for ns_val in ns {
                if let (Some(id), Some(label)) = (
                    ns_val.get("id").and_then(|v| v.as_str()),
                    ns_val.get("label").and_then(|v| v.as_str()),
                ) {
                    let color = ns_val.get("color").and_then(|v| v.as_str());
                    let ns = Namespace {
                        id: id.to_string(),
                        label: label.to_string(),
                        color: color.map(String::from),
                        created_at: None,
                    };
                    let _ = self.db.create_namespace(&ns);
                }
            }
        }

        // Migrate pods
        if let Some(pods) = json.get("pods").and_then(|v| v.as_array()) {
            for pod_val in pods {
                if let (Some(id), Some(name), Some(url), Some(ns)) = (
                    pod_val.get("id").and_then(|v| v.as_str()),
                    pod_val.get("name").and_then(|v| v.as_str()),
                    pod_val.get("url").and_then(|v| v.as_str()),
                    pod_val.get("namespace").and_then(|v| v.as_str()),
                ) {
                    let labels = pod_val.get("labels").cloned().unwrap_or_default();
                    let status = pod_val.get("status").and_then(|v| v.as_str()).map(String::from);
                    let pod = Pod {
                        id: id.to_string(),
                        name: name.to_string(),
                        url: url.to_string(),
                        namespace: ns.to_string(),
                        labels,
                        status,
                        created_at: pod_val.get("createdAt").and_then(|v| v.as_str()).map(String::from),
                        updated_at: None,
                    };
                    let _ = self.db.create_pod(&pod);
                }
            }
        }

        // Migrate deployments
        if let Some(deps) = json.get("deployments").and_then(|v| v.as_array()) {
            for dep_val in deps {
                if let (Some(id), Some(name), Some(ns)) = (
                    dep_val.get("id").and_then(|v| v.as_str()),
                    dep_val.get("name").and_then(|v| v.as_str()),
                    dep_val.get("namespace").and_then(|v| v.as_str()),
                ) {
                    let selector = dep_val.get("selector").cloned().unwrap_or_default();
                    let dep = Deployment {
                        id: id.to_string(),
                        name: name.to_string(),
                        namespace: ns.to_string(),
                        selector,
                        created_at: dep_val.get("createdAt").and_then(|v| v.as_str()).map(String::from),
                    };
                    let _ = self.db.create_deployment(&dep);
                }
            }
        }

        // Backup original JSON
        let backup_file = data_file.with_extension("json.bak");
        let _ = std::fs::copy(&data_file, &backup_file);
        tracing::info!("✅ Migrated data.json → SQLite (backup: {:?})", backup_file);

        Ok(())
    }
}