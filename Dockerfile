# Desk Bud website and relay. Render builds this file automatically.
FROM node:24-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

COPY server/src ./src
COPY server/public ./public

# Render sets PORT itself. 3000 is the default for running this anywhere else.
ENV PORT=3000
EXPOSE 3000

USER node
CMD ["node", "src/index.js"]
