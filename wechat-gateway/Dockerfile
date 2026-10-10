# 先安装锁定版本并编译共用规则，运行镜像只保留服务实际需要的文件。
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY build.cjs ./
COPY domain ./domain
RUN npm run build && npm prune --omit=dev
FROM node:22-alpine
# 云托管启动时会安装微信接口证书，先准备好系统更新证书的工具。
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json server.cjs config.cjs session.cjs repository.cjs service.cjs backup.cjs calendar.cjs account-session.cjs account-repository.cjs account-service.cjs permission-cache.cjs account-http.cjs ./
COPY --chown=node:node admin ./admin
USER node
ENV NODE_ENV=production PORT=8080
# Node自带证书列表，需要额外信任云托管在容器启动时提供的微信接口证书。
ENV NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt
EXPOSE 8080
CMD ["node", "server.cjs"]
