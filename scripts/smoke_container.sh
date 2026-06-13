#!/usr/bin/env bash
# Smoke-Test des gebauten Images gegen eine eigene Wegwerf-DB.
set -e
PW="smoketest-pw"
SECRET="smoke-only-secret-min-32-chars-aaaaaaaa"
docker rm -f slalom-smoke-db slalom-smoke-app >/dev/null 2>&1 || true
docker network create slalom-smoke >/dev/null 2>&1 || true

docker run -d --name slalom-smoke-db --network slalom-smoke \
  -e POSTGRES_USER=ksp -e POSTGRES_PASSWORD=ksp -e POSTGRES_DB=ksp \
  postgres:16-alpine >/dev/null
docker run -d --name slalom-smoke-app --network slalom-smoke \
  -e DATABASE_URL=postgres://ksp:ksp@slalom-smoke-db:5432/ksp \
  -e JWT_SECRET="$SECRET" \
  -e SEED_PASSWORD="$PW" \
  -p 3100:3001 \
  maik05/slalom-designer:latest >/dev/null
sleep 10

echo "HEALTH: $(curl -s http://localhost:3100/api/health)"
echo "LOGIN:  $(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3100/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"admin@kartslalom.local\",\"password\":\"$PW\"}")"
echo "FRONTEND: $(curl -s http://localhost:3100/ | head -c 80)"
echo "SEC-HEADERS:"; curl -s -D - -o /dev/null http://localhost:3100/api/health | grep -i -E 'content-security|x-content-type|x-frame' || echo "  (keine)"

docker rm -f slalom-smoke-db slalom-smoke-app >/dev/null
docker network rm slalom-smoke >/dev/null 2>&1 || true
echo "ok – Testcontainer entfernt"
