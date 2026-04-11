#!/bin/bash
# pg_dump backup script for Supabase
# Run weekly via cron: 0 3 * * 0 /path/to/backup_db.sh

SUPABASE_URL="${SUPABASE_URL:-}"
BACKUP_DIR="$(dirname "$0")/../backups"
DATE=$(date +%Y%m%d_%H%M%S)

if [ -z "$SUPABASE_URL" ]; then
  echo "ERROR: SUPABASE_URL not set"
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# Extract connection string from Supabase URL
# Format: postgresql://postgres:[password]@[host]:5432/postgres
DB_URL="${SUPABASE_URL/https:\/\//postgresql://postgres:${SUPABASE_SERVICE_KEY}@db.}"
DB_URL="${DB_URL}.supabase.co:5432/postgres"

echo "Backing up to $BACKUP_DIR/kckills_$DATE.sql..."
pg_dump "$DB_URL" --no-owner --no-privileges > "$BACKUP_DIR/kckills_$DATE.sql" 2>&1

if [ $? -eq 0 ]; then
  echo "Backup OK: kckills_$DATE.sql ($(wc -c < "$BACKUP_DIR/kckills_$DATE.sql") bytes)"
  # Keep only last 4 backups
  ls -t "$BACKUP_DIR"/kckills_*.sql | tail -n +5 | xargs rm -f 2>/dev/null
else
  echo "Backup FAILED"
  exit 1
fi
