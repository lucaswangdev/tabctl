//! HTTP request handlers

use crate::error::AppError;
use crate::schema::{
    ApiResponse, BatchCreatePodsRequest, BatchResponse, BookmarksImportRequest,
    CreateDeploymentRequest, CreateNamespaceRequest, CreatePodRequest, Deployment, ImportRequest,
    ImportResponse, Namespace, Pod, UpdatePodRequest,
};
use crate::state::AppState;
use axum::{
    extract::{Path, Query, State},
    http::StatusCode,
    Json,
};
use serde::Deserialize;
use std::sync::Arc;

// ── Health ──────────────────────────────────────────────────────────────────────

pub async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "version": "1.0.0",
        "db": "SQLite (rusqlite)"
    }))
}

// ── Pods ──────────────────────────────────────────────────────────────────────

pub async fn list_pods(
    State(state): State<Arc<AppState>>,
    Query(opts): Query<ListPodsQuery>,
) -> Result<Json<ApiResponse<Vec<Pod>>>, AppError> {
    let pods = state.db.list_pods(opts.namespace.as_deref())?;
    Ok(Json(ApiResponse {
        items: pods.clone(),
        total: Some(pods.len()),
    }))
}

#[derive(Debug, Deserialize)]
pub struct ListPodsQuery {
    pub namespace: Option<String>,
}

pub async fn get_pod(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<Pod>, AppError> {
    let pod = state
        .db
        .get_pod(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Pod \"{}\" not found", id)))?;
    Ok(Json(pod))
}

pub async fn create_pod(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreatePodRequest>,
) -> Result<(StatusCode, Json<Pod>), AppError> {
    // Check for duplicate
    let existing = state.db.list_pods(Some(&req.namespace))?;
    if existing.iter().any(|p| p.name == req.name) {
        return Err(AppError::Conflict(format!(
            "Pod \"{}\" already exists in namespace \"{}\"",
            req.name, req.namespace
        )));
    }

    let id = format!(
        "pod-{}{}",
        chrono::Utc::now().timestamp_millis(),
        &uuid::Uuid::new_v4().to_string()[..4]
    );
    let pod = Pod {
        id,
        name: req.name,
        url: normalize_url(&req.url),
        namespace: req.namespace,
        labels: req.labels.unwrap_or_default(),
        status: Some("Saved".to_string()),
        created_at: Some(chrono::Utc::now().to_rfc3339()),
        updated_at: None,
    };

    state.db.create_pod(&pod)?;
    tracing::info!("✅ Created pod: {} [{}]", pod.name, pod.namespace);
    Ok((StatusCode::CREATED, Json(pod)))
}

pub async fn update_pod(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
    Json(req): Json<UpdatePodRequest>,
) -> Result<Json<Pod>, AppError> {
    let existing = state
        .db
        .get_pod(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Pod \"{}\" not found", id)))?;

    let patch = Pod {
        id: id.clone(),
        name: req.name.unwrap_or(existing.name),
        url: req.url.map(|u| normalize_url(&u)).unwrap_or(existing.url),
        namespace: req.namespace.unwrap_or(existing.namespace),
        labels: req.labels.unwrap_or(existing.labels),
        status: req.status.or(existing.status),
        created_at: existing.created_at,
        updated_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    let updated = state
        .db
        .update_pod(&id, &patch)?
        .ok_or_else(|| AppError::NotFound(format!("Pod \"{}\" not found", id)))?;

    tracing::info!("✏️  Updated pod: {}", updated.name);
    Ok(Json(updated))
}

pub async fn delete_pod(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let pod = state
        .db
        .get_pod(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Pod \"{}\" not found", id)))?;

    state.db.delete_pod(&id)?;
    tracing::info!("🗑️  Deleted pod: {}", pod.name);
    Ok(Json(serde_json::json!({ "deleted": true, "pod": pod })))
}

pub async fn batch_create_pods(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BatchCreatePodsRequest>,
) -> Result<(StatusCode, Json<BatchResponse>), AppError> {
    let pods: Vec<Pod> = req
        .pods
        .iter()
        .map(|item| Pod {
            id: format!(
                "pod-{}{}",
                chrono::Utc::now().timestamp_millis(),
                &uuid::Uuid::new_v4().to_string()[..4]
            ),
            name: item
                .name
                .clone()
                .unwrap_or_else(|| url_to_name(&item.url)),
            url: normalize_url(&item.url),
            namespace: item
                .namespace
                .clone()
                .unwrap_or_else(|| req.namespace.clone()),
            labels: item.labels.clone().unwrap_or_default(),
            status: Some("Saved".to_string()),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            updated_at: None,
        })
        .collect();

    let (created, errors) = state.db.batch_create_pods(&pods)?;
    tracing::info!("📦 Batch: created {}, errors {}", created, errors);
    Ok((
        StatusCode::CREATED,
        Json(BatchResponse {
            created,
            skipped: errors,
            items: None,
        }),
    ))
}

// ── Deployments ────────────────────────────────────────────────────────────────

pub async fn list_deployments(
    State(state): State<Arc<AppState>>,
    Query(opts): Query<DeploymentsQuery>,
) -> Result<Json<ApiResponse<Vec<serde_json::Value>>>, AppError> {
    let deployments = state.db.list_deployments(opts.namespace.as_deref())?;
    let annotated: Vec<serde_json::Value> = deployments
        .into_iter()
        .map(|d| {
            serde_json::json!({
                "id": d.id,
                "name": d.name,
                "namespace": d.namespace,
                "selector": d.selector,
                "created_at": d.created_at,
                "matchingPods": state.db.list_pods(Some(&d.namespace)).map(|pods: Vec<Pod>| pods.len()).unwrap_or(0)
            })
        })
        .collect();
    Ok(Json(ApiResponse {
        items: annotated.clone(),
        total: Some(annotated.len()),
    }))
}

#[derive(Debug, Deserialize)]
pub struct DeploymentsQuery {
    pub namespace: Option<String>,
}

pub async fn create_deployment(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateDeploymentRequest>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let id = format!("dep-{}", chrono::Utc::now().timestamp_millis());
    let dep = Deployment {
        id: id.clone(),
        name: req.name,
        namespace: req.namespace,
        selector: req.selector,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state.db.create_deployment(&dep)?;
    tracing::info!("🚀 Created deployment: {}", dep.name);
    Ok((
        StatusCode::CREATED,
        Json(serde_json::json!({
            "id": id,
            "name": dep.name,
            "namespace": dep.namespace,
            "selector": dep.selector
        })),
    ))
}

pub async fn delete_deployment(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let dep = state
        .db
        .get_deployment(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Deployment \"{}\" not found", id)))?;

    state.db.delete_deployment(&id)?;
    tracing::info!("🗑️  Deleted deployment: {}", dep.name);
    Ok(Json(serde_json::json!({ "deleted": true, "deployment": dep })))
}

pub async fn get_deployment_pods(
    State(state): State<Arc<AppState>>,
    Path(id): Path<String>,
) -> Result<Json<serde_json::Value>, AppError> {
    let dep = state
        .db
        .get_deployment(&id)?
        .ok_or_else(|| AppError::NotFound(format!("Deployment \"{}\" not found", id)))?;

    let pods = state.db.list_pods(Some(&dep.namespace))?;
    Ok(Json(serde_json::json!({
        "deployment": dep,
        "pods": pods,
        "total": pods.len()
    })))
}

// ── Namespaces ─────────────────────────────────────────────────────────────────

pub async fn list_namespaces(
    State(state): State<Arc<AppState>>,
) -> Result<Json<ApiResponse<Vec<Namespace>>>, AppError> {
    let namespaces = state.db.list_namespaces()?;
    Ok(Json(ApiResponse {
        items: namespaces.clone(),
        total: Some(namespaces.len()),
    }))
}

const BUILT_IN_NAMESPACES: [&str; 4] = ["work", "research", "personal", "ops"];

pub async fn create_namespace(
    State(state): State<Arc<AppState>>,
    Json(req): Json<CreateNamespaceRequest>,
) -> Result<(StatusCode, Json<Namespace>), AppError> {
    let id = req
        .name
        .to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>();

    if BUILT_IN_NAMESPACES.contains(&id.as_str()) {
        return Err(AppError::Conflict(format!(
            "\"{}\" is a reserved name",
            req.name
        )));
    }

    let ns = Namespace {
        id: id.clone(),
        label: req.name,
        color: req.color,
        created_at: Some(chrono::Utc::now().to_rfc3339()),
    };

    state.db.create_namespace(&ns)?;
    tracing::info!("📁 Created namespace: {}", ns.label);
    Ok((StatusCode::CREATED, Json(ns)))
}

// ── Import/Export ──────────────────────────────────────────────────────────────

pub async fn export_data(
    State(state): State<Arc<AppState>>,
) -> Result<(StatusCode, Json<serde_json::Value>), AppError> {
    let (pods, deployments, namespaces) = state.db.export_all()?;
    let data = serde_json::json!({
        "apiVersion": "tabctl/v1",
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "pods": pods,
        "deployments": deployments,
        "namespaces": namespaces
    });
    Ok((StatusCode::OK, Json(data)))
}

pub async fn import_data(
    State(state): State<Arc<AppState>>,
    Json(req): Json<ImportRequest>,
) -> Result<Json<ImportResponse>, AppError> {
    let data = req.data;
    let mode = req.mode.as_str();

    if mode == "replace" {
        state.db.clear_all()?;
    }

    let mut created = 0;
    let mut skipped = 0;

    // Import pods
    if let Some(pods) = data.pods {
        for pod_val in pods {
            let url = pod_val.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let namespace = pod_val
                .get("namespace")
                .and_then(|v| v.as_str())
                .unwrap_or("work");
            let name = pod_val.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let labels = pod_val.get("labels").cloned().unwrap_or_default();
            let status = pod_val.get("status").and_then(|v| v.as_str()).map(String::from);
            let id = pod_val
                .get("id")
                .and_then(|v| v.as_str())
                .map(String::from)
                .unwrap_or_else(|| {
                    format!(
                        "pod-{}{}",
                        chrono::Utc::now().timestamp_millis(),
                        &uuid::Uuid::new_v4().to_string()[..4]
                    )
                });
            let created_at = pod_val
                .get("createdAt")
                .and_then(|v| v.as_str())
                .map(String::from);

            let pod = Pod {
                id,
                name: name.to_string(),
                url: url.to_string(),
                namespace: namespace.to_string(),
                labels,
                status,
                created_at,
                updated_at: None,
            };

            if mode == "merge" {
                let existing = state.db.list_pods(Some(namespace))?;
                if existing.iter().any(|p| p.url == pod.url) {
                    skipped += 1;
                    continue;
                }
            }

            if state.db.create_pod(&pod).is_ok() {
                created += 1;
            } else {
                skipped += 1;
            }
        }
    }

    Ok(Json(ImportResponse {
        mode: mode.to_string(),
        created,
        skipped,
    }))
}

pub async fn import_bookmarks(
    State(state): State<Arc<AppState>>,
    Json(req): Json<BookmarksImportRequest>,
) -> Result<Json<serde_json::Value>, AppError> {
    let entries = parse_chrome_bookmarks(&req.content);
    if entries.is_empty() {
        return Ok(Json(serde_json::json!({
            "created": 0,
            "skipped": 0,
            "createdNamespaces": [],
            "message": "No bookmarks found"
        })));
    }

    let mut created: usize = 0;
    let mut skipped: usize = 0;
    let mut created_namespaces: Vec<serde_json::Value> = Vec::new();

    let folder_names: Vec<String> = entries
        .iter()
        .filter_map(|e| Some(e.folder.clone()))
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();

    for folder in folder_names {
        let ns_id = folder
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>();

        if !BUILT_IN_NAMESPACES.contains(&ns_id.as_str()) {
            let ns = Namespace {
                id: ns_id.clone(),
                label: folder.clone(),
                color: None,
                created_at: Some(chrono::Utc::now().to_rfc3339()),
            };
            let _ = state.db.create_namespace(&ns);
            created_namespaces.push(serde_json::json!({ "id": ns_id, "label": folder }));
        }
    }

    for entry in entries {
        let ns_id = entry
            .folder
            .to_lowercase()
            .chars()
            .filter(|c| c.is_alphanumeric())
            .collect::<String>();
        let pod = Pod {
            id: format!(
                "pod-{}{}",
                chrono::Utc::now().timestamp_millis(),
                &uuid::Uuid::new_v4().to_string()[..4]
            ),
            name: entry.name,
            url: normalize_url(&entry.url),
            namespace: if BUILT_IN_NAMESPACES.contains(&ns_id.as_str()) {
                ns_id
            } else {
                req.default_ns.clone()
            },
            labels: serde_json::Value::Object(Default::default()),
            status: Some("Saved".to_string()),
            created_at: Some(chrono::Utc::now().to_rfc3339()),
            updated_at: None,
        };

        if state.db.create_pod(&pod).is_ok() {
            created += 1;
        } else {
            skipped += 1;
        }
    }

    tracing::info!(
        "📥 Bookmarks: created {}, skipped {}, namespaces {}",
        created,
        skipped,
        created_namespaces.len()
    );
    Ok(Json(serde_json::json!({
        "created": created,
        "skipped": skipped,
        "createdNamespaces": created_namespaces
    })))
}

// ── Helpers ────────────────────────────────────────────────────────────────────

fn normalize_url(url: &str) -> String {
    if url.starts_with("http") {
        url.to_string()
    } else {
        format!("https://{}", url)
    }
}

fn url_to_name(url: &str) -> String {
    normalize_url(url)
        .split('/')
        .nth(2)
        .unwrap_or(url)
        .trim_start_matches("www.")
        .split('.')
        .next()
        .unwrap_or(url)
        .to_string()
}

fn parse_chrome_bookmarks(html: &str) -> Vec<BookmarkEntry> {
    let mut entries = Vec::new();
    let mut folder_stack: Vec<(String, usize)> = Vec::new();

    let mut current_url = String::new();
    let mut current_name = String::new();

    for line in html.lines() {
        let line = line.trim();

        // Detect folder (H3 tag)
        if line.starts_with("<H3") {
            if let Some(start) = line.find('>').map(|i| i + 1) {
                if let Some(end) = line.find("</H3>") {
                    let folder_name = &line[start..end];
                    let depth = folder_stack.len();
                    folder_stack.truncate(depth.saturating_sub(1));
                    folder_stack.push((folder_name.to_string(), depth));
                }
            }
        }

        // Detect link (A tag)
        if line.starts_with("<A HREF=") {
            if let Some(url_start) = line.find("HREF=\"") {
                let url_start = url_start + 6;
                if let Some(url_end) = line[url_start..].find('"') {
                    current_url = line[url_start..url_start + url_end].to_string();
                }
            }
            if let Some(name_start) = line.find('>').map(|i| i + 1) {
                if let Some(name_end) = line[name_start..].find("</A>") {
                    current_name = line[name_start..name_start + name_end].to_string();
                }
            }

            if !current_url.is_empty()
                && !current_name.is_empty()
                && current_url.starts_with("http")
            {
                let folder = folder_stack
                    .last()
                    .map(|(n, _)| n.clone())
                    .unwrap_or_default();
                entries.push(BookmarkEntry {
                    url: current_url.clone(),
                    name: current_name.clone(),
                    folder,
                });
                current_url.clear();
                current_name.clear();
            }
        }
    }

    entries
}

struct BookmarkEntry {
    url: String,
    name: String,
    folder: String,
}