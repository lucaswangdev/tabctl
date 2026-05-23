//! Database schema definitions

use rusqlite::Row;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pod {
    pub id: String,
    pub name: String,
    pub url: String,
    pub namespace: String,
    pub labels: serde_json::Value,
    pub status: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

impl Pod {
    pub fn from_row(row: &Row) -> Self {
        let labels_str: String = row.get("labels").unwrap_or_default();
        let labels =
            serde_json::from_str(&labels_str).unwrap_or(serde_json::Value::Object(Default::default()));
        Self {
            id: row.get("id").unwrap_or_default(),
            name: row.get("name").unwrap_or_default(),
            url: row.get("url").unwrap_or_default(),
            namespace: row.get("namespace").unwrap_or_default(),
            labels,
            status: row.get("status").ok(),
            created_at: row.get("created_at").ok(),
            updated_at: row.get("updated_at").ok(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Deployment {
    pub id: String,
    pub name: String,
    pub namespace: String,
    pub selector: serde_json::Value,
    pub created_at: Option<String>,
}

impl Deployment {
    pub fn from_row(row: &Row) -> Self {
        let selector_str: String = row.get("selector").unwrap_or_default();
        let selector =
            serde_json::from_str(&selector_str).unwrap_or(serde_json::Value::Object(Default::default()));
        Self {
            id: row.get("id").unwrap_or_default(),
            name: row.get("name").unwrap_or_default(),
            namespace: row.get("namespace").unwrap_or_default(),
            selector,
            created_at: row.get("created_at").ok(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Namespace {
    pub id: String,
    pub label: String,
    pub color: Option<String>,
    pub created_at: Option<String>,
}

impl Namespace {
    pub fn from_row(row: &Row) -> Self {
        Self {
            id: row.get("id").unwrap_or_default(),
            label: row.get("label").unwrap_or_default(),
            color: row.get("color").ok(),
            created_at: row.get("created_at").ok(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DbStats {
    pub pods: usize,
    pub namespaces: usize,
    pub deployments: usize,
}

// ── API request/response types ────────────────────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct CreatePodRequest {
    pub name: String,
    pub url: String,
    pub namespace: String,
    pub labels: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct UpdatePodRequest {
    pub name: Option<String>,
    pub url: Option<String>,
    pub namespace: Option<String>,
    pub labels: Option<serde_json::Value>,
    pub status: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BatchCreatePodsRequest {
    pub pods: Vec<PodInput>,
    #[serde(default = "default_namespace")]
    pub namespace: String,
}

fn default_namespace() -> String {
    "work".to_string()
}

#[derive(Debug, Deserialize)]
pub struct PodInput {
    pub name: Option<String>,
    pub url: String,
    pub namespace: Option<String>,
    pub labels: Option<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct CreateDeploymentRequest {
    pub name: String,
    pub namespace: String,
    pub selector: serde_json::Value,
}

#[derive(Debug, Deserialize)]
pub struct CreateNamespaceRequest {
    pub name: String,
    pub color: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct ApiResponse<T> {
    pub items: T,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub total: Option<usize>,
}

#[derive(Debug, Serialize)]
pub struct BatchResponse {
    pub created: usize,
    pub skipped: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub items: Option<Vec<Pod>>,
}

#[derive(Debug, Serialize)]
pub struct ImportResponse {
    pub mode: String,
    pub created: usize,
    pub skipped: usize,
}

#[derive(Debug, Deserialize)]
pub struct ImportRequest {
    pub data: ImportData,
    #[serde(default = "default_mode")]
    pub mode: String,
}

fn default_mode() -> String {
    "merge".to_string()
}

#[derive(Debug, Deserialize)]
pub struct ImportData {
    pub pods: Option<Vec<serde_json::Value>>,
    pub deployments: Option<Vec<serde_json::Value>>,
    pub namespaces: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Deserialize)]
pub struct BookmarksImportRequest {
    pub content: String,
    #[serde(default = "default_namespace")]
    pub default_ns: String,
}