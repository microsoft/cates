# syntax=docker/dockerfile:1.7
#
# Multi-stage build for cates-analyzer
#
# Base: node:24-alpine
#   - Small (~50 MB), regularly patched, official Node image.
#   - Pure-JS deps so musl libc is fine.
#   - distroless was considered but rejected: cates shells out to `git`
#     and `gh` to clone repos for review, which distroless can't host.
#
# Dependabot updates both the tag and digest so base-image changes remain
# explicit, reviewable, and reproducible.

ARG NODE_IMAGE=node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1

# ---------- deps stage: install full deps + build TS ----------
FROM ${NODE_IMAGE} AS build
WORKDIR /app

# Build-only tooling. No runtime impact.
RUN apk add --no-cache --virtual .build-deps python3 make g++ \
 && npm config set fund false \
 && npm config set update-notifier false

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY tsconfig.json tsconfig.service.json ./
COPY src ./src
COPY service ./service
RUN npm run build \
 && npm run build:service \
 && npm prune --omit=dev \
 && apk del .build-deps

# ---------- runtime stage: minimal, non-root ----------
FROM ${NODE_IMAGE} AS runtime

# Runtime tools cates shells out to:
#   git        - clone repos for review
#   github-cli - preferred clone path when available
#   ca-certs   - HTTPS to github.com
#   tini       - PID 1 to reap zombies (matters in k8s Jobs)
RUN apk upgrade --no-cache \
 && apk add --no-cache git github-cli ca-certificates tini \
 && rm -rf /usr/local/lib/node_modules/npm \
 && rm -f /usr/local/bin/npm /usr/local/bin/npx \
 && addgroup -S cates && adduser -S -G cates -h /home/cates cates \
 && mkdir -p /work /home/cates/.config/gh \
 && chown -R cates:cates /work /home/cates

WORKDIR /app

# Copy built artifacts and pruned production node_modules from build stage.
COPY --from=build --chown=cates:cates /app/package.json /app/package.json
COPY --from=build --chown=cates:cates /app/node_modules /app/node_modules
COPY --from=build --chown=cates:cates /app/dist /app/dist
COPY --from=build --chown=cates:cates /app/dist-service /app/dist-service
COPY --chown=cates:cates README.md LICENSE CATES-v1.0.md /app/
COPY --chown=cates:cates docs /app/docs

# Drop privileges. Default WORKDIR for analysis is /work so users can
# bind-mount their repo: `docker run --rm -v "$PWD:/work" cates .`
#
# This image supports two roles:
#   1. CLI  (default ENTRYPOINT):  docker run --rm -v "$PWD:/work" cates .
#   2. SERVICE (override ENTRYPOINT):
#      docker run -p 8080:8080 --entrypoint node cates \
#        /app/dist-service/service/server.js
USER cates
WORKDIR /work

ENV NODE_ENV=production \
    NO_COLOR= \
    npm_config_update_notifier=false

# tini handles signals + zombie reaping cleanly.
ENTRYPOINT ["/sbin/tini", "--", "node", "/app/dist/cli/index.js"]
CMD ["--help"]

# OCI labels for traceability.
LABEL org.opencontainers.image.title="cates-analyzer" \
      org.opencontainers.image.description="Analyze coding agent configurations for token efficiency, security, and CATES conformance" \
      org.opencontainers.image.source="https://github.com/microsoft/cates" \
      org.opencontainers.image.licenses="MIT"
