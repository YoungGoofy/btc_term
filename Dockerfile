FROM node:20-alpine AS builder

WORKDIR /app
COPY web/package*.json ./web/

# Устанавливаем зависимости с legacy-peer-deps на случай конфликтов React/Vite
WORKDIR /app/web
RUN npm install

# Копируем исходники и собираем
COPY web/ ./
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
WORKDIR /app/web

# Копируем package.json с обновленными зависимостями (express, http-proxy-middleware)
COPY --from=builder /app/web/package.json ./package.json

# Устанавливаем ТОЛЬКО production зависимости
RUN npm install --omit=dev

# Копируем скомпилированное React приложение и server.js
COPY --from=builder /app/web/dist ./dist
COPY --from=builder /app/web/server.js ./server.js

ENV PORT=3000
ENV LOG_FILE_PATH=/app/data/signal_log.txt

# Создаем папку для логов
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["node", "server.js"]
