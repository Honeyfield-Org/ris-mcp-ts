FROM node:22-alpine AS builder

RUN corepack enable pnpm
WORKDIR /app
ENV HUSKY=0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json vite.ui.config.ts ./
COPY src/ ./src/
# Widget sources: `pnpm run build` bundles them into src/generated/ first, so
# the compiled server carries the HTML in dist/generated/ — no runtime file
# lookup, nothing extra to copy into the runtime stage.
COPY ui/ ./ui/
COPY scripts/ ./scripts/
# The build runs the three-project typecheck (root, ui, tests) — the host-sim
# suite itself never runs here, but its tsconfig and the files it includes must
# exist or `tsc -p tests/tsconfig.json` fails the image build (v1.6.0 lesson:
# the image build only runs on tag pushes, so a PR never catches this).
COPY tests/ ./tests/
COPY playwright.host.config.ts ./
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
