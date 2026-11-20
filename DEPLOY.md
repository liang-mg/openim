# Docker 部署指南（OA 二开）

> **一句话**：clone 本仓库 → 一条命令 → 打开浏览器。
> 官方底座 compose/config、前端完整源码都已打包进仓库，**不用再 clone 官方 openim-docker 和 openim-electron-demo**。

---

## 前置（只装一次）

| 软件 | 用途 | 是否必须 |
|---|---|---|
| Docker + Docker Compose | 跑全部服务；Go 编译、前端构建都在镜像内完成 | ✅ 必须 |
| Git | clone 仓库（也可直接下载 zip 解压） | 推荐 |

> **不用装 Go，不用装 Node/pnpm。** 后端在镜像里编译，前端在镜像里 pnpm install + vite build。

---

## 两步部署

### 第 1 步：clone 仓库

```bash
git clone https://github.com/liang-mg/openim.git
cd openim
```

仓库里已经自带的（无需再拉）：

```
openim/
├── base/            ← 官方底座 docker-compose.yaml + config/（不用 clone openim-docker）
├── frontend/        ← 完整前端源码，已含全部 OA 页面（不用 clone demo、不用打补丁）
├── backend/         ← OA 后端源码
├── deploy/          ← 一键脚本 + compose override
└── config-template/ ← 脱敏 env 模板
```

### 第 2 步：一条命令启动

```bash
bash deploy/deploy.sh bootstrap
```

脚本自动完成：预检 → 生成 `.env` 和随机密钥 → 构建后端/前端两个镜像（Go 和 pnpm 都在镜像里跑）→ 启动 mongo/minio → 启动 OA 服务 + 前端 → 健康检查。看到 `OA 环境已就绪` 即成功。

浏览器打开 **http://127.0.0.1:5173**。

登录验证码 `666666`（需要 IM 服务 openim-server / openim-chat 已启动）。新环境先按 `docs/OA测试账号与权限说明.md` 建档。

> 如果只起了 OA 服务没起 IM，页面能打开但无法登录验证码。要么在官方底座里把 `openim-server` / `openim-chat` 起起来，要么只验证 OA 接口：`curl http://127.0.0.1:10010/oa/api/v1/healthz`。

---

## 日常运维

```bash
cd deploy
bash deploy.sh status          # 所有容器状态
bash deploy.sh logs            # 后端日志
bash deploy.sh logs oa-web     # 前端日志
bash deploy.sh verify          # 健康检查
bash deploy.sh up              # 启动 OA 服务 + 前端
bash deploy.sh down            # 停止（不动数据卷）
bash deploy.sh restart         # 重启
bash deploy.sh build           # 改代码后重新构建两个镜像
```

---

## 生产环境（上线前必看）

1. **不要用脚本生成的随机密钥**：手动设置强密码，`XINBO_OA_TOKEN_SECRET` 必须与 chat 的 `config/chat-rpc-admin.yml` 里 secret 一致，否则登录态全部 401。
2. **前端已容器化**：`oa-web` 用 nginx 提供构建产物，`/oa` 反代不带尾斜杠（带斜杠会剥掉前缀导致 404）。生产环境把它放到 HTTPS 反代后面。
3. **HTTPS**：非 HTTPS 下浏览器禁用摄像头和定位，打卡功能不可用。
4. **备份**：`mongodump` 每日备份 + 保留 7 天。

---

## 故障排查

<details>
<summary>镜像构建失败 / 想理解每一步在做什么，展开看</summary>

### 构建相关

- **后端构建失败**：`GOPROXY` 不通时设 `GOPROXY=https://goproxy.cn,direct`，`deploy.sh build` 会透传为 `--build-arg`。
- **前端构建失败**：npm registry 不通时改 `frontend/.npmrc` 的镜像源；构建必须用 `vite.web.config.ts`（默认配置带 electron 插件会拉桌面窗口）。
- **Docker daemon 未启动**：`docker info` 能返回即正常，否则先启动 Docker Desktop。

### 登录相关

- **页面能开但验证码失败**：IM 服务没起。检查 `openim-server` / `openim-chat` 容器状态。
- **接口全部 401**：`XINBO_OA_TOKEN_SECRET` 和 chat 的 secret 不一致。

### 手动等价步骤（理解 bootstrap 做了什么）

```bash
cd openim
# 1. 配置
cp config-template/oa.env.example .env
# 编辑 .env 替换所有 <CHANGE_ME_*>

# 2. 构建两个镜像（Go / pnpm 都在镜像内）
cd deploy && bash deploy.sh build

# 3. 起底座 + OA
docker compose -f ../base/docker-compose.yaml --env-file ../.env up -d mongo minio
docker compose -f ../base/docker-compose.yaml -f docker-compose.oa.yaml --env-file ../.env up -d xinbo-oa oa-web

# 4. 验证
bash deploy.sh verify
```

### 回归验证

```bash
export OA_TOKEN_SECRET=<和 .env 里 XINBO_OA_TOKEN_SECRET 一致>
export MONGO_PASSWORD=<和 .env 里 MONGO_PASSWORD 一致>
node scripts/oa_e2e_check.js
node scripts/oa_team_attendance_check.js
node scripts/oa_leave_makeup_api_check.js
```

UI 脚本需 `playwright-core`（`pnpm add -D playwright-core`），可设 `CHROME_PATH` 指定浏览器。完整脚本和账号见 `docs/OA测试账号与权限说明.md`。

</details>

---

## 常见坑

- **底座升级**：本仓库自带的 `base/` 是官方底座快照。升级官方版本时替换 `base/docker-compose.yaml` 和 `base/config/`，OA override 不用改。
- **改了 chat secret 必须同步 `XINBO_OA_TOKEN_SECRET`**，否则接口全部 401。
- **MinIO 桶名 ≥3 字符**（`oa` 会报错），本项目用 `xinbo-oa`。
- **前端源码基线**：`frontend/` 基于官方 demo commit `62d7ca7` 打好补丁；`frontend-patch/` 保留作差异对账，见 `CHANGES.md`。
