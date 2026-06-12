#!/usr/bin/env bash
# Multi-Platform-Image (amd64 + arm64 + armv7) bauen und zu Docker Hub pushen.
# Voraussetzung: docker login (maik05). QEMU wird bei Bedarf installiert.
set -e
cd "$(dirname "$0")/.."

VERSION="${1:-1.0.0}"
IMAGE="maik05/slalom-designer"
PLATFORMS="linux/amd64,linux/arm64,linux/arm/v7"

# QEMU-Emulatoren für Fremd-Architekturen registrieren
docker run --privileged --rm tonistiigi/binfmt --install arm64,arm >/dev/null

# Multi-Platform braucht einen container-Builder
docker buildx inspect slalom-builder >/dev/null 2>&1 || \
  docker buildx create --name slalom-builder --driver docker-container >/dev/null

docker buildx build \
  --builder slalom-builder \
  --platform "$PLATFORMS" \
  -t "$IMAGE:$VERSION" \
  -t "$IMAGE:latest" \
  --push \
  .

echo "--- Manifest ---"
docker buildx imagetools inspect "$IMAGE:latest" | grep -E "Platform|Name:" | head -12
