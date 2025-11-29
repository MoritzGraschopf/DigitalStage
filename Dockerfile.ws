FROM node:24-alpine

WORKDIR /app

# Nur was du wirklich brauchst
COPY package*.json ./
RUN npm ci --omit=dev

COPY websocket.mjs ./

EXPOSE 3001
CMD ["node", "websocket.mjs"]
