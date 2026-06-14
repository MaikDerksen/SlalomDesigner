#!/usr/bin/env bash
# Simuliert das NAS-Deployment 1:1: nur Compose-Datei + .env, Image aus Registry.
set -u
IMG=maik05/slalom-designer:1.1.0
DIR=/tmp/nas-sim
SRC=/mnt/c/Users/mderksen/IdeaProjects/KartSlalomCircut

echo "=== Manifest (alle Architekturen?) ==="
docker buildx imagetools inspect "$IMG" | grep -E 'Name:|Platform:' | head -10

echo "=== Lokales Image entfernen -> erzwingt echten Pull wie auf dem NAS ==="
docker rmi "$IMG" >/dev/null 2>&1; echo "  (lokal entfernt, falls vorhanden)"

rm -rf "$DIR"; mkdir -p "$DIR"
# Genau das, was der NutzerNAS hat: Compose als docker-compose.yml + .env
cp "$SRC/deploy/docker-compose.nas.yml" "$DIR/docker-compose.yml"
cp "$SRC/deploy/.env" "$DIR/.env"

cd "$DIR"
echo "=== docker compose up -d (zieht Image, startet db+app) ==="
docker compose up -d 2>&1 | tail -6

echo "=== auf Health warten ==="
for i in $(seq 1 60); do curl -sf http://localhost:3001/api/health >/dev/null 2>&1 && break; sleep 1; done

echo "=== Container-Status ==="
docker compose ps --format '  {{.Service}}: {{.Status}}'

echo "=== App-Checks ==="
curl -s -o /dev/null -w "  health=%{http_code}\n" http://localhost:3001/api/health
HTML=$(curl -s http://localhost:3001/)
echo "  index startet mit: $(echo "$HTML" | head -c 30)"
ASSET=$(echo "$HTML" | grep -o '/assets/[^\"]*\.js' | head -1)
curl -s -o /dev/null -w "  js-asset=%{http_code} type=%{content_type}\n" "http://localhost:3001$ASSET"
echo "  upgrade-insecure-requests? $(curl -s -D - -o /dev/null http://localhost:3001/ | grep -iq upgrade-insecure-requests && echo JA-FEHLER || echo nein-gut)"
echo "  Seed-Passwort-Log: $(docker compose logs app 2>&1 | grep -i 'Passwort' | head -1 | sed 's/^.*app[^|]*| //')"
curl -s -o /dev/null -w "  login=%{http_code}\n" -X POST http://localhost:3001/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@kartslalom.local","password":"nastest123"}'

echo "=== Teardown ==="
docker compose down -v 2>&1 | tail -2
cd /; rm -rf "$DIR"
echo "=== fertig ==="
