# 1. Build Stage – Next.js App bauen
FROM node:24-alpine AS builder

WORKDIR /app

# Nur die App-Dependencies reinziehen
COPY ../apps/web/package*.json ./
# Falls du prisma/ im Projekt hast:
COPY ../apps/web/prisma ./prisma

RUN npm ci
RUN npx prisma generate

# Rest der Next.js App kopieren
COPY apps/web .

# Next.js Build
RUN npm run build

# 2. Runtime Stage – schlanker Container für Production
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Nur das Nötigste aus dem Builder übernehmen
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000
CMD ["npm", "start"]
