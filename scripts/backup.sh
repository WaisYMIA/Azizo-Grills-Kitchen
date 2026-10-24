#!/bin/bash
# Makes a dated copy of the Node database and uploaded photos. Run daily from cron, then copy the result OFF the server.
#   scripts/backup.sh /home/youruser/azizo-app /home/youruser/backups
APP="${1:-./backend}"; DEST="${2:-./backups}"; STAMP=$(date +%Y%m%d-%H%M); mkdir -p "$DEST"
DB="${DB_PATH:-$APP/azizo.db}"
if command -v sqlite3 >/dev/null 2>&1 && [ -f "$DB" ]; then sqlite3 "$DB" ".backup '$DEST/azizo-$STAMP.db'"; else cp "$DB" "$DEST/azizo-$STAMP.db"; fi
tar -czf "$DEST/azizo-uploads-$STAMP.tar.gz" -C "$APP" uploads private 2>/dev/null
find "$DEST" -name 'azizo-*' -mtime +30 -delete
echo "Backup written to $DEST (stamp $STAMP)"
