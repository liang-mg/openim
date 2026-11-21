# Docker 部署指南（OA 二开）

> **一句话**：clone 本仓库 → 一条命令 → 打开浏览器。
> 服务编排（compose/config）和完整前端源码都已打包进仓库，clone 本仓库即可，**无需再拉其他代码**。

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
├── base/            ← 服务编排 docker-compose.yaml + config/（已随仓库附带）
├── frontend/        ← 完整前端源码，已含全部 OA 页面（不用 clone demo、不用打补丁）
├── backend/         ← OA 后端源码
├── deploy/          ← 一键脚本 + compose override
└── config-template/ ← 脱敏 env 模板
```

### 第 2 步：一条命令启动

```bash
bash deploy/deploy.sh bootstrap
```

脚本自动完成：预检 → 生成 `.env` 和随机密钥 → 构建后端/前端两个镜像（Go 和 pnpm 都在镜像里跑）→ 启动底座（mongo/minio/redis/etcd/kafka）→ 启动 IM 服务（openim-server/openim-chat）→ 启动 OA 服务 + 前端 + 管理后台 → 健康检查。看到 `OA 环境已就绪` 即成功。

> **IM 服务是登录的前提，已纳入 bootstrap**：`openim-server`/`openim-chat` 官方镜像较大，首次拉取可能要几分钟，请勿中途断开终端。`openim-server` 有约 5 分钟健康检查观察期，`openim-chat` 会在它就绪后自动启动。前端 nginx 已改为动态解析上游，即使 IM 尚未就绪，页面也能正常打开（只是登录接口暂不可用），不会再出现整站反复重启。

浏览器打开：
- **OA 网页版：http://127.0.0.1:5173**
- **管理后台：http://127.0.0.1:11002**（已是「新博」品牌，logo / 标题 / 欢迎语均已替换，无需手动打补丁）

> 管理后台的品牌覆盖文件在 `frontend-custom/admin/`，随仓库分发。它是官方 admin 镜像（Umi 构建产物）按文件名挂载覆盖，不修改官方镜像；`deploy/docker-compose.brand.yaml` 声明这些挂载，`deploy.sh` 自动加载。若浏览器仍显示旧品牌，按 `Ctrl+F5` 强刷清缓存。

用**账号（手机号）+ 密码**登录，六个测试账号的密码见 `docs/OA测试账号与权限说明.md`（需要 IM 服务 openim-server / openim-chat 已启动）。新环境先在 IM 侧建账号，再到 OA「员工与权限」建档并指定上级。

> 如果只起了 OA 服务没起 IM，页面能打开但登录会失败。用 `bash deploy/deploy.sh up` 会连带起 IM 服务；或手动补：`docker compose -f ../base/docker-compose.yaml --env-file ../.env up -d redis etcd kafka openim-server openim-chat`。只验证 OA 接口可用 `curl http://127.0.0.1:10010/oa/api/v1/healthz`。

---

## 日常运维

```bash
cd deploy
bash deploy.sh status          # 所有容器状态
bash deploy.sh logs            # 后端日志
bash deploy.sh logs oa-web     # 前端日志
bash deploy.sh verify          # 健康检查（含管理后台 11002 品牌检查）
bash deploy.sh up              # 启动 OA 服务 + 前端 + 管理后台
bash deploy.sh down            # 停止（不动数据卷）
bash deploy.sh restart         # 重启
bash deploy.sh build           # 改代码后重新构建两个镜像
```

> `up` / `restart` 会带上管理后台（`openim-admin-front`）；品牌覆盖由 `deploy/docker-compose.brand.yaml` 自动挂载。要单独看后台日志：`bash deploy.sh logs openim-admin-front`。

---

## 功能开关（`.env` 里改，重启生效）

| 变量 | 默认 | 作用 |
|---|---|---|
| `XINBO_OA_WORK_ON_TIME` / `XINBO_OA_WORK_OFF_TIME` | `09:05` / `18:00` | 首次启动的作息默认值。管理员在「员工与权限 → 考勤规则」保存过之后以页面为准 |
| `XINBO_OA_MAKEUP_MAX_DAYS` / `XINBO_OA_MAKEUP_MAX_MONTH` | `7` / `3` | 补卡可补天数、每月上限（同上，规则页可改） |
| `XINBO_OA_AUTO_SCAN` | `true` | 考勤异常自动扫描（启动后每 30 分钟扫最近 3 天）。设 `false` 只能手动触发 |
| `XINBO_OA_IM_PUSH_URL` | 空 | 通知推到 IM 的 webhook。留空只发站内信，接口会返回 `pushed=false` |
| `XINBO_OA_IM_PUSH_TOKEN` | 空 | 上面 webhook 的 Bearer token（可选） |

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

- **页面能开但登录失败**：IM 服务没起，或密码不对。先检查 `openim-server` / `openim-chat` 容器状态（chat 若是 unhealthy，等 mongo/server 就绪后 `docker restart openim-chat`）。
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
node scripts/oa_exception_check.js     # 考勤异常 + 规则配置
node scripts/oa_approval_check.js      # 审批中心 + 催交 + 通知
```

UI 脚本需 `playwright-core`（`pnpm add -D playwright-core`），可设 `CHROME_PATH` 指定浏览器。完整脚本和账号见 `docs/OA测试账号与权限说明.md`。

</details>

---

## 常见坑

- **底座更新**：本仓库自带的 `base/` 是服务编排快照。需要更新时替换 `base/docker-compose.yaml` 和 `base/config/`，OA override 不用改。
- **改了 chat secret 必须同步 `XINBO_OA_TOKEN_SECRET`**，否则接口全部 401。
- **MinIO 桶名 ≥3 字符**（`oa` 会报错），本项目用 `xinbo-oa`。
- **前端源码基线**：`frontend/` 是已含全部 OA 改动的完整源码（基线 commit `62d7ca7`）；`frontend-patch/` 保留作改动对账，见 `CHANGES.md`。
