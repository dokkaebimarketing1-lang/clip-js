FROM node:22-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium ffmpeg fonts-noto-cjk ca-certificates \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=production \
    REMOTION_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium \
    CLIPJS_REMOTION_BUNDLE_DIR=/app/remotion-bundle \
    CLIPJS_RENDER_OUTPUT_DIR=/data/renders \
    CLIPJS_GENERATION_REPOSITORY_DIR=/data/runtime/generation \
    CLIPJS_GENERATED_ASSET_DIR=/data/runtime/assets \
    CLIPJS_RENDER_JOB_DIR=/data/runtime/render-jobs
RUN npm run build
RUN mkdir -p /data/renders /data/runtime

EXPOSE 3000
CMD ["npm", "start"]
