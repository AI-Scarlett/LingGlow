FROM node:22-bookworm-slim AS dependencies

WORKDIR /app/commerce-service
COPY commerce-service/package.json commerce-service/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    COMMERCE_HOST=0.0.0.0 \
    PORT=8787

WORKDIR /app

# Build with the repository root as context:
# docker build -f commerce-service/Dockerfile .
COPY --chown=node:node src/products.mjs src/entitlements.mjs src/catalog.mjs src/profile.mjs \
    src/capability-schema.mjs src/union-profile.mjs ./src/
COPY --chown=node:node src/catalog ./src/catalog
COPY --chown=node:node catalog ./catalog
COPY --chown=node:node commerce-service ./commerce-service
COPY --from=dependencies --chown=node:node /app/commerce-service/node_modules ./commerce-service/node_modules

USER node
EXPOSE 8787

CMD ["node", "commerce-service/src/main.mjs"]
