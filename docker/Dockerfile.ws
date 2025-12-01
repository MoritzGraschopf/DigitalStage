FROM node:24-alpine AS runner

WORKDIR /app

# Nur WebSocket-Dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Rest des WebSocket-Projekts
COPY . .

ENV NODE_ENV=production

EXPOSE 3010
CMD ["npm", "start"]
