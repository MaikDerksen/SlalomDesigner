# Kart Slalom Planner – API + Frontend in einem Container
FROM node:20-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV NODE_ENV=production
EXPOSE 3001
CMD ["npx", "tsx", "server/index.ts"]
