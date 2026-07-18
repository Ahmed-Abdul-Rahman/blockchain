# DeChat Compose interop node image — builds workspace packages needed by @dechat/core.
FROM node:22-bookworm-slim AS build

WORKDIR /app

RUN corepack enable

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/ ./.yarn/
COPY packages/common/package.json ./packages/common/
COPY packages/crypto/package.json ./packages/crypto/
COPY packages/core/package.json ./packages/core/

# Placeholder workspace packages so yarn install resolves the monorepo graph.
COPY packages/blockchain/package.json ./packages/blockchain/
COPY packages/examples/package.json ./packages/examples/
COPY apps/backend/package.json ./apps/backend/

# Skip workspace lifecycle scripts (root postinstall malware scan needs scripts/ not in image).
# Rebuild native addons core needs after skip-build.
RUN yarn install --immutable --mode=skip-build \
  && yarn rebuild classic-level cbor-extract esbuild

COPY packages/common ./packages/common
COPY packages/crypto ./packages/crypto
COPY packages/core ./packages/core
COPY tsconfig.json ./

RUN yarn workspace @dechat/common build \
  && yarn workspace @dechat/crypto build \
  && yarn workspace @dechat/core build

FROM node:22-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=perf
ENV LOG_LEVEL=INFO

COPY --from=build /app /app

WORKDIR /app/packages/core

EXPOSE 4001

CMD ["node", "dist/tests/compose-interop/composeNodeMain.js"]
