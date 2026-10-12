# The processor (server/) as a container: Node 22 with ffmpeg, ffprobe, a bold font for the captions, and Chromium,
# which motion-graphic-skill's record.js drives to paint each frame of a short (server/assets/motion-graphic-skill).
# wrangler builds it with server/ as the build context (see wrangler.jsonc). No .env is copied in:
# keys reach the container as Worker secrets at start.

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core ca-certificates chromium \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY assets ./assets
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
