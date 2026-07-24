#!/bin/bash
# Backup bazy finansowej (cron na seohost, codziennie ~03:00).
# Wymaga zmiennych z .env (DB_*). Trzyma 30 dni wstecz.
set -euo pipefail
ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env}"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a
BACKUP_DIR="${BACKUP_DIR:-$HOME/backups/finansowa}"
mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y-%m-%d)
FILE="$BACKUP_DIR/finansowa-$STAMP.sql.gz"
mysqldump -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" | gzip > "$FILE" \
  && echo "OK backup: $FILE ($(du -h "$FILE" | cut -f1))" \
  || { echo "BŁĄD backupu"; exit 1; }
find "$BACKUP_DIR" -name 'finansowa-*.sql.gz' -mtime +30 -delete
