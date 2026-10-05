# syntax=docker/dockerfile:1

# Сборка зависимостей отдельным слоем: пока package-lock.json не менялся,
# npm ci не перезапускается и деплой идёт быстрее.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY src ./src
COPY public ./public

# Каталог для SQLite: нужен, только если контейнер запускают без DATABASE_URL.
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
EXPOSE 3000

# Запускаем node напрямую, без npm: процесс становится PID 1 и сам получает
# SIGTERM от Render — срабатывает корректное закрытие сервера и пула БД.
CMD ["node", "server.js"]
