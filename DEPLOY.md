# Docker 部署指南（OA 二开）

> 目标：最短路径把 OA 环境跑起来。前端本地开发 + 后端全套 Docker。
> 一行命令启动，无需手动改官方 compose 文件。

---

## 前置（只装一次）

| 软件 | 用途 | 是否必须 |
|---|---|---|
| Docker + Docker Compose | 跑 mongo / minio / OA 服务，**Go 后端也在镜像内编译** | ✅ 必须 |
| Git | clone 仓库（也可直接下载 zip 解压，非必需） | 推荐 |
| Node 18+ / pnpm | 仅本地开发前端时需要；只跑后端或用现成静态包不需要 | 可选 |

> 后端部署**不用在本地装 Go**：`backend/Dockerfile` 是多阶段构建，编译在镜像里完成。
> 如果只想验证后端接口，装 Docker 一个软件就够了，第 3 步前端可以跳过。

---

## 三步部署

### 第 1 步：放好目录

本仓库必须是官方底座的子目录：

```
/work/openim-docker/            ← git clone 官方 openim-docker（含 docker-compose.yaml）
/work/openim-docker/oa-custom/  ← git clone 本仓库到这里
```

### 第 2 步：一键启动后端

```bash
cd /work/openim-docker/oa-custom/deploy
bash deploy.sh bootstrap
```

脚本自动完成：预检 → 生成 `.env` 和随机密钥 → 构建镜像（镜像内编译 Go 后端）→ 启动 mongo/minio + OA → 健康检查。看到 `OA 环境已就绪` 即成功。

### 第 3 步：启动前端（可选，本地开发才需要）

```bash
cd /work/openim-docker
git clone https://github.com/openimsdk/openim-electron-demo.git
cp -r oa-custom/frontend-patch/* openim-electron-demo/
cd openim-electron-demo && pnpm install && pnpm dev
```

打开 **http://127.0.0.1:5173**。

登录走验证码 `666666`（需要能连到 IM 服务）。新环境先按 `docs/OA测试账号与权限说明.md` 建档。

---

## 日常运维

```bash
cd oa-custom/deploy
bash deploy.sh status    # 容器状态
bash deploy.sh logs      # 实时日志
bash deploy.sh verify    # 健康检查
bash deploy.sh up        # 启动
bash deploy.sh down      # 停止（不动官方底座）
bash deploy.sh restart   # 重启
bash deploy.sh build     # 改代码后重新编译+构建镜像
```

---

## 生产环境（上线前必看）

1. **不要用脚本生成的随机密钥**：手动设置强密码，`XINBO_OA_TOKEN_SECRET` 必须与 chat 的 `config/chat-rpc-admin.yml` 里 secret 一致，否则登录态全部 401。
2. **前端走构建产物**：`pnpm build` 出静态包，nginx `/oa` 反代**不带尾斜杠**（带斜杠会剥掉 `/oa` 前缀导致 404）。
3. **HTTPS**：非 HTTPS 下浏览器禁用摄像头和定位，打卡功能不可用。
4. **备份**：`mongodump` 每日备份 + 保留 7 天。

---

## 故障排查

<details>
<summary>脚本失败时，展开看手动步骤（理解每一步在做什么）</summary>

### 1. 拉官方底座

```bash
git clone https://github.com/openimsdk/openim-docker.git
git clone https://github.com/openimsdk/openim-electron-demo.git
```

前端 demo 基线 commit：`62d7ca7`。升级官方版本时，`frontend-patch/` 的改动需重新对账，见 `CHANGES.md`。

### 2. 覆盖 OA 补丁

```bash
cp -r oa-custom/frontend-patch/* openim-electron-demo/
```

Windows PowerShell：`Copy-Item -Recurse -Force oa-custom\frontend-patch\* openim-electron-demo\`

### 3. 配置环境变量

```bash
cp oa-custom/config-template/oa.env.example <openim-docker>/.env
# 替换所有 <CHANGE_ME_*>，尤其各类密码和 token secret
cp oa-custom/config-template/frontend.env.local.example <openim-electron-demo>/.env.local
```

**安全红线**：真实 `.env` / `.env.local` 绝不提交 Git。

### 4. 构建并启动 OA 后端（无需本地 Go）

```bash
cd oa-custom/deploy
bash deploy.sh build     # Dockerfile 多阶段构建，镜像内编译 Go 后端
bash deploy.sh up
curl http://127.0.0.1:10010/oa/api/v1/healthz
```

早期版本要本地 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build`，漏了会容器 Restarting；现在编译已内置到 `backend/Dockerfile`，不会再踩这个坑。GOPROXY 不通时设 `GOPROXY=https://goproxy.cn,direct`（`deploy.sh build` 会透传为 `--build-arg`）。

### 5. 启动前端

```bash
cd openim-electron-demo && pnpm install && pnpm dev
```

### 6. 跑回归验证

```bash
export OA_TOKEN_SECRET=<和 .env 里 XINBO_OA_TOKEN_SECRET 一致>
export MONGO_PASSWORD=<和 .env 里 MONGO_PASSWORD 一致>
node oa-custom/scripts/oa_e2e_check.js
node oa-custom/scripts/oa_team_attendance_check.js
node oa-custom/scripts/oa_leave_makeup_api_check.js
```

UI 脚本需 `playwright-core`（`pnpm add -D playwright-core`），可设 `CHROME_PATH` 指定浏览器。完整脚本和账号见 `docs/OA测试账号与权限说明.md`。

</details>

---

## 常见坑

- **脚本必须在官方底座同级目录执行**（本仓库是它的子目录），否则 compose 找不到官方文件；可用 `OA_COMPOSE` 指定。
- **改了 chat secret 必须同步 `XINBO_OA_TOKEN_SECRET`**，否则接口全部 401。
- **MinIO 桶名 ≥3 字符**（`oa` 会报错），本项目用 `xinbo-oa`。
- **GOPROXY 不通**时设 `GOPROXY=https://goproxy.cn,direct`。
