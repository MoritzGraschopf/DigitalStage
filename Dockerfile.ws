FROM node:24-alpine

# ✅ Alles, was mediasoup zum Bauen braucht:
# - python3 (wird als "python" verlinkt)
# - make, g++, linux-headers (Build-Toolchain)
RUN apk add --no-cache python3 py3-pip make g++ linux-headers \
    && ln -sf /usr/bin/python3 /usr/bin/python

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "ws-server.mjs"]
