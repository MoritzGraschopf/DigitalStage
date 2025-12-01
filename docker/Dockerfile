FROM node:24-alpine AS builder

WORKDIR /app

# package.json + prisma zuerst
COPY apps/web/package*.json ./
COPY apps/web/prisma ./prisma

RUN npm ci
RUN npx prisma generate

# Rest der Next.js App
COPY apps/web .
RUN npm run build

# ---------------- Runtime ----------------
FROM node:24-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

# Wichtig: prisma in die Runtime kopieren!
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

EXPOSE 3000
CMD ["npm", "start"]
