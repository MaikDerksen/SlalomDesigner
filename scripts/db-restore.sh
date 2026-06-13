#!/usr/bin/env bash
# Stellt die SlalomDesigner-Datenbank aus einem Backup wieder her.
# ACHTUNG: überschreibt die aktuelle Datenbank.
#
#     bash scripts/db-restore.sh backups/slalom-20260613-120000.dump
#     COMPOSE_FILE=deploy/docker-compose.nas.yml bash scripts/db-restore.sh <datei> [--yes]
set -euo pipefail

FILE="${1:-}"
DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${POSTGRES_USER:-ksp}"
DB_NAME="${POSTGRES_DB:-ksp}"

if [ -z "$FILE" ] || [ ! -f "$FILE" ]; then
  echo "Aufruf: bash scripts/db-restore.sh <backup.dump> [--yes]" >&2
  exit 1
fi

dc() { if [ -n "${COMPOSE_FILE:-}" ]; then docker compose -f "$COMPOSE_FILE" "$@"; else docker compose "$@"; fi; }

cid="$(dc ps -q "$DB_SERVICE")"
if [ -z "$cid" ]; then
  echo "Fehler: DB-Service '$DB_SERVICE' läuft nicht." >&2
  exit 1
fi

if [ "${2:-}" != "--yes" ]; then
  echo "Dies überschreibt die Datenbank '$DB_NAME' mit '$FILE'."
  read -r -p "Fortfahren? (ja/NEIN) " ans
  [ "$ans" = "ja" ] || { echo "Abgebrochen."; exit 1; }
fi

echo "Stelle Datenbank '$DB_NAME' wieder her …"
docker cp "$FILE" "$cid:/tmp/restore.dump"
# --clean --if-exists: vorhandene Objekte vor dem Import entfernen; --no-owner:
# Eigentümer ignorieren. Hinweise zu nicht vorhandenen Objekten sind unkritisch.
dc exec -T "$DB_SERVICE" pg_restore --clean --if-exists --no-owner -U "$DB_USER" -d "$DB_NAME" /tmp/restore.dump || true
dc exec -T "$DB_SERVICE" rm -f /tmp/restore.dump

echo "Wiederherstellung abgeschlossen. App ggf. neu starten: docker compose restart app"
