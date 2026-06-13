#!/usr/bin/env bash
# Sichert die SlalomDesigner-Datenbank aus dem laufenden Docker-Compose-Stack.
#
# Aufruf aus dem Verzeichnis mit der docker-compose.yml (Dev: Projektwurzel,
# NAS: das Deploy-Verzeichnis):
#     bash scripts/db-backup.sh            # → ./backups/slalom-YYYYmmdd-HHMMSS.dump
#     COMPOSE_FILE=deploy/docker-compose.nas.yml bash scripts/db-backup.sh
#
# Funktioniert unabhängig davon, ob der DB-Port veröffentlicht ist: pg_dump läuft
# IM Container, die Dump-Datei wird per `docker cp` binärsicher herauskopiert.
set -euo pipefail

DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-ksp}"
DB_NAME="${POSTGRES_DB:-ksp}"
OUT_DIR="${BACKUP_DIR:-backups}"

dc() { if [ -n "${COMPOSE_FILE:-}" ]; then docker compose -f "$COMPOSE_FILE" "$@"; else docker compose "$@"; fi; }

cid="$(dc ps -q "$DB_SERVICE")"
if [ -z "$cid" ]; then
  echo "Fehler: DB-Service '$DB_SERVICE' läuft nicht (docker compose up -d zuerst)." >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
ts="$(date +%Y%m%d-%H%M%S)"
out="$OUT_DIR/slalom-$ts.dump"

echo "Sichere Datenbank '$DB_NAME' aus Container ${cid:0:12} …"
dc exec -T "$DB_SERVICE" sh -c "pg_dump -U '$DB_USER' -Fc '$DB_NAME' > /tmp/slalom.dump"
docker cp "$cid:/tmp/slalom.dump" "$out"
dc exec -T "$DB_SERVICE" rm -f /tmp/slalom.dump

echo "Backup gespeichert: $out"
ls -lh "$out" | awk '{print "  Größe: " $5}'
