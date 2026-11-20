# OA 前端镜像：Node 构建 + nginx 提供服务
# 构建：docker build -t xinbo-oa-web:local ./frontend
# 本地无需 Node/pnpm，全部在镜像内完成。
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY package.json pnpm-lock.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

COPY . .

# 同源相对路径：/api /chat /msg_gateway 等由 nginx 反代，前端无需知道后端地址
RUN printf 'VITE_BASE_HOST=127.0.0.1\nVITE_WS_URL=/msg_gateway\nVITE_API_URL=/api\nVITE_CHAT_URL=/chat\n' > .env.local

# 必须用 web 配置：默认 vite.config.ts 带 electron 插件，会拉起桌面窗口
RUN pnpm exec vite build --config vite.web.config.ts

FROM nginx:1.25-alpine
RUN apk add --no-cache tzdata && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx/site.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
