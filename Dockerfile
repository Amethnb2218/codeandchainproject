# SENTABAKH LITE — prod image (Node 24, backend + frontend built)
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/package.json
COPY server/package.json server/package.json
COPY client/package.json client/package.json
RUN npm ci
COPY shared/ shared/
COPY server/ server/
COPY client/ client/
COPY vite.config.* tsconfig.* eslint.config.* ./
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/shared/package.json shared/package.json
COPY --from=build /app/server/package.json server/package.json
COPY --from=build /app/client/package.json client/package.json
RUN npm ci --omit=dev
COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/client/dist client/dist
EXPOSE 10000
CMD ["npm", "start", "--workspace=server"]
