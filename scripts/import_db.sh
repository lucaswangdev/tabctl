#!/bin/bash
# Import a .sql backup file into ~/.tabctl/tabctl.db

if [ -z "$1" ]; then
    echo "Usage: $0 <path-to-sql-file>"
    echo "Example: $0 ~/.tabctl/backups/tabctl_export_2026-05-23_23-20-45.sql"
    exit 1
fi

SQL_FILE="$1"
DB_PATH="$HOME/.tabctl/tabctl.db"
BACKUP_DIR="$HOME/.tabctl/backups"

# Check if SQL file exists
if [ ! -f "${SQL_FILE}" ]; then
    echo "Error: SQL file not found at ${SQL_FILE}"
    exit 1
fi

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Backup current database if it exists
if [ -f "${DB_PATH}" ]; then
    TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
    cp "${DB_PATH}" "${BACKUP_DIR}/tabctl.db.bak-${TIMESTAMP}"
    echo "Backed up current database to ${BACKUP_DIR}/tabctl.db.bak-${TIMESTAMP}"
fi

# Remove existing database and recreate from SQL
rm -f "${DB_PATH}"
sqlite3 "${DB_PATH}" < "${SQL_FILE}"

if [ $? -eq 0 ]; then
    echo "Success: Imported ${SQL_FILE} into ${DB_PATH}"
else
    echo "Error: Import failed"
    exit 1
fi