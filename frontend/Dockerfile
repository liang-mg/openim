# OA 前端镜像：Node 构建 + nginx 提供服务
# 构建：docker build -t xinbo-oa-web:local ./frontend
# 本地无需 Node/pnpm，全部在镜像内完成。
FROM node:20-alpine AS builder

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate

COPY package.json pnpm-lock.yaml .npmrc ./
# package.json 的 pnpm.patchedDependencies 引用了 patches/ 下的补丁，
# 必须在 install 前 COPY，否则 pnpm 找不到补丁文件（ENOENT）
COPY patches/ ./patches/
# pnpm 10 默认会执行所有依赖的 postinstall。electron / koffi 的原生模块需要
# CMake 等系统依赖，alpine 构建镜像里没有，会导致 install 失败。
# 这里只放行 Web 构建真正需要的两个原生模块，其余（含 electron/koffi）跳过构建脚本。
# Web 版用 vite.web.config.ts，不依赖 electron，跳过其 postinstall 无影响。
# 注意：本文件与 deploy/Dockerfile.oa-web 需保持一致，改动请同步。
RUN node -e "const fs=require('fs'); const manifest=JSON.parse(fs.readFileSync('package.json','utf8')); manifest.pnpm.onlyBuiltDependencies=['@parcel/watcher','esbuild']; fs.writeFileSync('package.json',JSON.stringify(manifest));"
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
