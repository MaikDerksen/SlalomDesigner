# SlalomDesigner – API + Frontend in einem Container
# Multi-Stage: Build (Vite) -> schlanke Runtime (nur Produktions-Abhängigkeiten)

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
# Server (tsx fuehrt TS direkt aus) + geteilte Module + Reglement-PDF-Asset
COPY server ./server
COPY src ./src
COPY --from=build /app/dist ./dist
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1
CMD ["npx", "tsx", "server/index.ts"]
