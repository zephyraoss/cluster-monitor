FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS builder

WORKDIR /app

ARG TARGETPLATFORM
ARG BUILDPLATFORM

COPY package*.json ./
RUN bun install

COPY src ./src
RUN bun build src/index.ts --outdir ./dist --target bun

FROM oven/bun:1-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Create non-root user with dynamic UID
RUN addgroup -S appgroup && \
    adduser -S appuser -G appgroup

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

USER appuser

EXPOSE 3000

ENTRYPOINT ["bun", "run", "dist/index.js"]

CMD []
