# 1. Build Stage
FROM node:18-alpine AS builder

WORKDIR /app

# Nur was nötig ist, um Prisma und Node Modules zu installieren
COPY package*.json prisma ./

# Installieren & Prisma Client generieren
RUN npm install
RUN npx prisma generate

# Rest des Projekts kopieren
COPY . .

# Next.js App bauen
RUN npm run build

# 2. Production Stage
FROM node:18-alpine AS runner

WORKDIR /app

# Nur das Nötigste kopieren
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/next.config.* ./

# Production-Umgebung setzen
ENV NODE_ENV=production

EXPOSE 3000
CMD ["npm", "start"]
