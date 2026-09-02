# Multi-stage Dockerfile for multi-agent-platform

# Stage 1: Build TypeScript app
FROM node:22-alpine AS builder

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependency files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source files
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript to JavaScript
RUN pnpm run build

# Stage 2: Runtime image
FROM node:22-alpine AS runner

WORKDIR /app

# Enable pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy production dependencies and built dist
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

COPY --from=builder /app/dist ./dist

# Expose Web Server Adapter port
EXPOSE 3000

# Default command: Start Web Server mode or CLI
ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["web-server", "--port", "3000", "Initial requirement prompt"]
