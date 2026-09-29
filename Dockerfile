FROM node:24-bookworm-slim

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    DISPLAY=:99 \
    NODE_ENV=production \
    HOME=/home/node \
    HOST=127.0.0.1 \
    PORT=3000 \
    BEES_DB_PATH=/app/data/bees.sqlite \
    BEES_BROWSER_PROFILE=/app/session/browser-profile

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
    && npx playwright install --with-deps chromium \
    && apt-get update \
    && apt-get install -y --no-install-recommends xvfb x11vnc novnc websockify fluxbox nginx apache2-utils supervisor x11-utils \
    && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
RUN npm run build && node --test dist/tests/*.test.js && npm prune --omit=dev

COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisord.conf /etc/supervisor/supervisord.conf
COPY docker/entrypoint.sh /usr/local/bin/bees-entrypoint
RUN sed -i 's/\r$//' /usr/local/bin/bees-entrypoint \
    && chmod +x /usr/local/bin/bees-entrypoint \
    && mkdir -p /app/data /app/session /home/node/.fluxbox \
    && chown -R node:node /app/data /app/session /home/node \
    && chmod -R a+rX /ms-playwright

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["bees-entrypoint"]
