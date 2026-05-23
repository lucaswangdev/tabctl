#!/bin/bash
# Export tabctl database to a timestamped .sql file

DB_PATH="${HOME}/.tabctl/tabctl.db"
BACKUP_DIR="${HOME}/.tabctl/backups"
TIMESTAMP=$(date +"%Y-%m-%d_%H-%M-%S")
OUTPUT_FILE="${BACKUP_DIR}/tabctl_export_${TIMESTAMP}.sql"

# Create backup directory if it doesn't exist
mkdir -p "${BACKUP_DIR}"

# Check if database exists
if [ ! -f "${DB_PATH}" ]; then
    echo "Error: Database not found at ${DB_PATH}"
    exit 1
fi

# Export database to SQL file
echo "Exporting database to ${OUTPUT_FILE}..."
sqlite3 "${DB_PATH}" ".backup '${BACKUP_DIR}/tabctl_temp.db'" && \
sqlite3 "${BACKUP_DIR}/tabctl_temp.db" ".dump" > "${OUTPUT_FILE}" && \
rm "${BACKUP_DIR}/tabctl_temp.db"

if [ $? -eq 0 ]; then
    echo "Success: Exported to ${OUTPUT_FILE}"
else
    echo "Error: Export failed"
    exit 1
fi