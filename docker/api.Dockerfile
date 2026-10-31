FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable pnpm
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY backend/package.json backend/
RUN pnpm install --filter backend --frozen-lockfile
COPY backend backend
RUN cd backend && npx prisma generate && pnpm build

FROM node:22-alpine
WORKDIR /app
RUN corepack enable pnpm
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma
COPY --from=build /app/backend/package.json backend/
WORKDIR /app/backend
EXPOSE 3001
CMD npx prisma migrate deploy && node dist/server.js
