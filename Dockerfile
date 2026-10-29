# Image unique : API Node.js + interface compilée servie par le même processus.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY server server
COPY web web
ARG VITE_TILE_URL
ARG VITE_PANORAMAX_URL
ARG VITE_SATELLITE_URL
ARG VITE_SATELLITE_ATTRIBUTION
ENV VITE_TILE_URL=${VITE_TILE_URL} VITE_PANORAMAX_URL=${VITE_PANORAMAX_URL} VITE_SATELLITE_URL=${VITE_SATELLITE_URL} VITE_SATELLITE_ATTRIBUTION=${VITE_SATELLITE_ATTRIBUTION}
RUN npm run build -w server && npm run build -w web && npm prune --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 WEB_DIST=/app/web/dist
COPY package.json ./
COPY server/package.json server/
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/migrations server/migrations
COPY --from=build /app/web/dist web/dist
USER node
EXPOSE 3000
CMD ["node", "server/dist/main.js"]
