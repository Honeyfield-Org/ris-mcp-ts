FROM node:22-alpine AS builder

RUN corepack enable pnpm
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

FROM node:22-alpine

RUN corepack enable pnpm
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod --ignore-scripts
COPY --from=builder /app/dist/ ./dist/

# Runtime environment. Set AFTER the --prod install so it does not interfere
# with dependency resolution. Enables production behaviour in http.ts (the
# NODE_ENV !== 'test' gate still passes, so app.listen/sweep/shutdown run).
ENV NODE_ENV=production

EXPOSE 3000
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/http.js"]
