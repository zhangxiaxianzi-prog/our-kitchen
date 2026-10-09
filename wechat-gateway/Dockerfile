# 运行环境使用官方Node镜像，服务没有第三方运行依赖。
FROM node:22-alpine
WORKDIR /app
COPY --chown=node:node package.json server.cjs ./
USER node
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
CMD ["node", "server.cjs"]
