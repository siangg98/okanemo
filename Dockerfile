# syntax=docker/dockerfile:1.7

# --- build stage ---------------------------------------------------------
FROM node:24-alpine AS build
WORKDIR /app

# install deps from the lockfile only, so this layer caches across src edits
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY . .
RUN npm run build

# --- runtime stage -------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app
COPY package.json ./
COPY --from=build /app/dist ./dist
COPY server ./server
ENV HOST=0.0.0.0 PORT=8080 OKANEMO_DATA_DIR=/data OKANEMO_BACKUP_DIR=/backups TZ=Asia/Kuala_Lumpur
EXPOSE 8080
CMD ["node", "server/server.js"]
