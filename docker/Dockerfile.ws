FROM node:24-alpine AS runner

WORKDIR /app

# 1) Abhängigkeiten für mediasoup:
#    - python3 + pip
#    - build tools (make, g++)
#    - Symlink "python" -> "python3", weil mediasoup "python" aufruft
RUN apk add --no-cache python3 py3-pip make g++ \
    && ln -s /usr/bin/python3 /usr/bin/python

# 2) Nur package*.json kopieren und Prod-Dependencies installieren
COPY package*.json ./
RUN npm ci --omit=dev

# 3) Restlichen Code kopieren
COPY . .

ENV NODE_ENV=production

EXPOSE 3010
CMD ["npm", "start"]
