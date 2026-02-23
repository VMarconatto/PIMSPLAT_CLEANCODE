FROM node:20-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --legacy-peer-deps
COPY dist ./dist

CMD ["node", "./dist/messaging/consumer.main.js"]
