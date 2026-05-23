//! tabctl-server — High-performance local REST API server for browser tabs
//!
//! Uses SQLite database with Rust for optimal performance.

#![deny(unsafe_code)]

mod backup;
mod db;
mod error;
mod handlers;
mod schema;
mod state;

use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, Level};
use tracing_subscriber::FmtSubscriber;

use crate::state::AppState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Initialize logging
    let subscriber = FmtSubscriber::builder()
        .with_max_level(Level::INFO)
        .with_target(false)
        .finish();
    tracing::subscriber::set_global_default(subscriber)?;

    // Initialize application state (opens/creates database)
    let state = Arc::new(AppState::new().await?);
    let stats = state.get_stats()?;
    info!(
        "📋 Database initialized: {} pods, {} namespaces, {} deployments",
        stats.pods, stats.namespaces, stats.deployments
    );

    // Run migrations if needed
    state.migrate_from_json()?;

    // Build router
    let app = Router::new()
        .route("/health", axum::routing::get(handlers::health))
        .route(
            "/api/pods",
            axum::routing::get(handlers::list_pods).post(handlers::create_pod),
        )
        .route(
            "/api/pods/{id}",
            axum::routing::get(handlers::get_pod)
                .put(handlers::update_pod)
                .delete(handlers::delete_pod),
        )
        .route("/api/pods/batch", axum::routing::post(handlers::batch_create_pods))
        .route(
            "/api/deployments",
            axum::routing::get(handlers::list_deployments)
                .post(handlers::create_deployment),
        )
        .route(
            "/api/deployments/{id}",
            axum::routing::delete(handlers::delete_deployment),
        )
        .route(
            "/api/deployments/{id}/pods",
            axum::routing::get(handlers::get_deployment_pods),
        )
        .route("/api/namespaces", axum::routing::get(handlers::list_namespaces).post(handlers::create_namespace))
        .route("/api/namespaces/{id}", axum::routing::delete(handlers::delete_namespace))
        .route("/api/export", axum::routing::get(handlers::export_data))
        .route("/api/import", axum::routing::post(handlers::import_data))
        .route(
            "/api/import/bookmarks",
            axum::routing::post(handlers::import_bookmarks),
        )
        .layer(
            CorsLayer::new()
                .allow_origin(Any)
                .allow_methods(Any)
                .allow_headers(Any),
        )
        .with_state(state.clone());

    let listener = tokio::net::TcpListener::bind("0.0.0.0:7420").await?;
    info!(
        "🚀 tabctl-server running at http://localhost:7420\n   Database: {}",
        state.db_path().display()
    );
    axum::serve(listener, app).await?;

    Ok(())
}