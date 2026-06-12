#!/usr/bin/env bash
# Stellt das Docker-Hub-Repo auf privat (nutzt die lokale Docker-Anmeldung).
set -e
REPO="maik05/slalom-designer"
AUTH=$(python3 -c "import json,base64;print(base64.b64decode(json.load(open('$HOME/.docker/config.json'))['auths']['https://index.docker.io/v1/']['auth']).decode())")
TOKEN=$(curl -s -X POST https://hub.docker.com/v2/users/login \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"${AUTH%%:*}\",\"password\":\"${AUTH#*:}\"}" | python3 -c "import sys,json;print(json.load(sys.stdin).get('token',''))")
if [ -z "$TOKEN" ]; then echo "Login an der Hub-API fehlgeschlagen"; exit 1; fi
curl -s -o /dev/null -X POST "https://hub.docker.com/v2/repositories/$REPO/privacy/" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"is_private": true}'
curl -s "https://hub.docker.com/v2/repositories/$REPO/" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;print('is_private:',json.load(sys.stdin).get('is_private'))"
