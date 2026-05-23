//! Database backup utilities

use std::fs;
use std::path::Path;

/// Backup an existing database file before opening it
pub fn backup_existing_db(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }

    let timestamp = chrono::Utc::now().to_rfc3339().replace(':', "-");
    let backup_path = path.with_extension(format!(
        "db.bak-{}.{}",
        timestamp,
        path.extension().unwrap_or_default().to_string_lossy()
    ));

    fs::copy(path, &backup_path)?;
    println!("📋 Backed up existing database to: {:?}", backup_path);
    Ok(())
}