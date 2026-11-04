FROM node:24.18-alpine3.22
WORKDIR /app
COPY --chown=node:node server.mjs ./server.mjs
COPY --chown=node:node public ./public
ENV NODE_ENV=production PORT=4173 HOST=0.0.0.0
USER node
EXPOSE 4173
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 CMD node -e "fetch('http://127.0.0.1:4173/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server.mjs"]
