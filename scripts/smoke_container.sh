#!/usr/bin/env bash
# Smoke-Test des gebauten Images gegen die laufende Dev-Datenbank
set -e
docker rm -f slalom-test >/dev/null 2>&1 || true
docker run -d --name slalom-test \
  --network kartslalomcircut_default \
  -e DATABASE_URL=postgres://ksp:ksp@db:5432/ksp \
  -e JWT_SECRET=testsecret \
  -p 3100:3001 \
  maik05/slalom-designer:latest >/dev/null
sleep 8
echo "HEALTH: $(curl -s http://localhost:3100/api/health)"
echo "LOGIN:  $(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:3100/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@kartslalom.local","password":"kart2026"}')"
echo "FRONTEND: $(curl -s http://localhost:3100/ | head -c 80)"
echo "PDF: $(curl -s -c /tmp/sm.jar -X POST http://localhost:3100/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@kartslalom.local","password":"kart2026"}' >/dev/null && curl -s -b /tmp/sm.jar http://localhost:3100/api/wiki | head -c 100)"
docker rm -f slalom-test >/dev/null
echo "ok – Testcontainer entfernt"
