FROM node:24-alpine AS runner

WORKDIR /app

RUN apk add --no-cache python3 py3-pip make g++ \
    && if [ ! -e /usr/bin/python ]; then ln -s /usr/bin/python3 /usr/bin/python; fi

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production

EXPOSE 3010
CMD ["npm", "start"]
