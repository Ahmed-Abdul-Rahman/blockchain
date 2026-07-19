# DeChat Compose interop node image — builds workspace packages needed by @dechat/core.
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/ ./.yarn/
# Root postinstall runs scanMalware → scripts/shai-hulud-scan.js
COPY scripts ./scripts
COPY packages/common/package.json ./packages/common/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/core/package.json ./packages/core/

# Placeholder workspace packages so yarn install resolves the monorepo graph.
COPY packages/blockchain/package.json ./packages/blockchain/
COPY packages/examples/package.json ./packages/examples/
COPY apps/backend/package.json ./apps/backend/

RUN yarn install --immutable

COPY packages/common ./packages/common
COPY packages/crypto ./packages/crypto
COPY packages/core ./packages/core
COPY tsconfig.json ./

# Root-hoisted bins (tsc-alias, etc.) are not on PATH under workspace hoistingLimits.
ENV PATH="/app/node_modules/.bin:${PATH}"

RUN yarn workspace @dechat/common build \
  && yarn workspace @dechat/crypto build \
  && yarn workspace @dechat/core build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=perf
ENV LOG_LEVEL=INFO
ENV NETEM_PROFILE=lan

RUN apt-get update \
  && apt-get install -y --no-install-recommends iproute2 iptables \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app /app

WORKDIR /app/packages/core

RUN chmod +x tests/compose-interop/scripts/apply-netem.sh \
  tests/compose-interop/scripts/docker-entrypoint.sh \
  tests/compose-interop/scripts/apply-partition.sh

EXPOSE 4001

ENTRYPOINT ["bash", "tests/compose-interop/scripts/docker-entrypoint.sh"]
