FROM node:24-slim AS runner

WORKDIR /app

# Optional, aber schadet nicht – falls mediasoup doch python braucht:
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Nur WebSocket-Dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Rest des WebSocket-Projekts
COPY . .

ENV NODE_ENV=production

EXPOSE 3010
CMD ["npm", "start"]
