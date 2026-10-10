# 先安装锁定版本并编译共用规则，运行镜像只保留服务实际需要的文件。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY build.cjs ./
COPY domain ./domain
RUN npm run build && npm prune --omit=dev
FROM node:22-alpine
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json server.cjs config.cjs session.cjs repository.cjs service.cjs backup.cjs calendar.cjs account-session.cjs account-repository.cjs account-service.cjs permission-cache.cjs account-http.cjs ./
COPY --chown=node:node admin ./admin
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.cjs"]
