# Multi-stage Dockerfile for multi-agent-platform

# Stage 1: Build TypeScript app
FROM node:22-alpine AS builder

WORKDIR /app

# Pin the package manager used by the deployment image. Install it explicitly
# so the build does not depend on Corepack's mutable metadata/cache. A build
# proxy can be supplied by the CI runner without becoming a runtime setting.
ARG BUILD_HTTP_PROXY=
ARG BUILD_HTTPS_PROXY=
ARG BUILD_NO_PROXY=
ENV HTTP_PROXY=${BUILD_HTTP_PROXY} \
    HTTPS_PROXY=${BUILD_HTTPS_PROXY} \
    NO_PROXY=${BUILD_NO_PROXY} \
    http_proxy=${BUILD_HTTP_PROXY} \
    https_proxy=${BUILD_HTTPS_PROXY} \
    no_proxy=${BUILD_NO_PROXY}
RUN npm install --global --no-audit --no-fund pnpm@10.17.0

# Copy workspace manifests before installing so the workspace:* dependency is
# resolved without copying the host's node_modules into the build context.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json packages/types/tsconfig.json ./packages/types/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/

# Install dependencies
RUN pnpm install --frozen-lockfile --fetch-retries 5 --fetch-timeout 120000

ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    NO_PROXY= \
    http_proxy= \
    https_proxy= \
    no_proxy=

# Copy source files
COPY tsconfig.json ./
COPY src ./src
COPY packages/types/src ./packages/types/src

# Build TypeScript to JavaScript
RUN pnpm --filter @multi-agent/types build && pnpm run build

# Stage 2: Runtime image
FROM node:22-alpine AS runner

WORKDIR /app

# Keep the runtime package manager aligned with the builder. The optional
# proxy is only available during dependency installation and is cleared in the
# resulting image.
ARG BUILD_HTTP_PROXY=
ARG BUILD_HTTPS_PROXY=
ARG BUILD_NO_PROXY=
ENV HTTP_PROXY=${BUILD_HTTP_PROXY} \
    HTTPS_PROXY=${BUILD_HTTPS_PROXY} \
    NO_PROXY=${BUILD_NO_PROXY} \
    http_proxy=${BUILD_HTTP_PROXY} \
    https_proxy=${BUILD_HTTPS_PROXY} \
    no_proxy=${BUILD_NO_PROXY}
RUN npm install --global --no-audit --no-fund pnpm@10.17.0

# Copy production dependencies and built dist
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/types/package.json ./packages/types/
COPY apps/server/package.json ./apps/server/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --prod --frozen-lockfile --fetch-retries 5 --fetch-timeout 120000

ENV HTTP_PROXY= \
    HTTPS_PROXY= \
    NO_PROXY= \
    http_proxy= \
    https_proxy= \
    no_proxy=

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/packages/types/dist ./packages/types/dist

# Expose Web Server Adapter port
EXPOSE 3000

# Default command: Start Web Server mode or CLI
ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["start", "Initial requirement prompt"]
