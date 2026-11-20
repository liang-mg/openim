# OpenIM OA 二开 · 协作仓库

> 本仓库只放**我们自己写的 OA 二开代码**，不包含 OpenIM 官方开源代码。
> 官方底座请各自 clone，按本文把本仓库的补丁覆盖上去即可协作开发。

---

## 一、这个仓库装了什么

| 目录 | 内容 | 来源 |
|---|---|---|
| `backend/` | 完整 OA 后端服务（Go/Gin/MongoDB/MinIO），可直接编译 | 自建，无官方对应 |
| `frontend-patch/` | 前端 OA 相关的新增页面 + 被改动的官方文件 | 基于官方 `openim-electron-demo` |
| `docs/` | OA 设计文档、排期、账号说明、日报 | 自建 |
| `scripts/` | OA 接口/UI 回归脚本（19 个） | 自建 |
| `config-template/` | 脱敏的环境变量模板 | 自建 |
| `deploy/` | **一键部署脚本 + compose override** | 自建 |

**不在本仓库**（各人自行准备）：
- OpenIM 官方后端：`openim-server`、`chat`、`openim-docker`（部署编排）
- 官方前端 demo：`openim-electron-demo`（`frontend-patch/` 要覆盖到它上面）
- 真实 `.env`、`.env.local`（含密钥，禁止入库）
- `node_modules/`、`dist/`、`bin/` 等构建产物

---

## 二、一键部署（推荐，新同事从这里开始）

把本仓库放在官方底座同级目录，然后一条命令搞定：

```bash
# 目录布局
/work/openim-docker/            # 官方底座（含 docker-compose.yaml）
/work/openim-docker/oa-custom/  # 本仓库（git clone 到这里）

# 一键：预检 -> 自动生成 .env 和随机密钥 -> 编译后端 -> 构建镜像 -> 启动底座+OA -> 健康检查
cd /work/openim-docker/oa-custom/deploy
bash deploy.sh bootstrap
```

完成后：

```
bash deploy.sh status    # 看容器状态
bash deploy.sh logs      # 看 OA 日志
bash deploy.sh verify    # 健康检查 + 冒烟
bash deploy.sh up        # 日常启动
bash deploy.sh down      # 停止 OA（不动底座）
bash deploy.sh restart   # 重启
bash deploy.sh build     # 只重新编译+构建镜像（改代码后）
```

`bootstrap` 会自动做这些事：
1. 检查 docker / go / compose / 模板是否就绪；
2. 若没有 `.env`，从模板生成并填入**随机密钥**（首次）；已有则不覆盖；
3. Go 交叉编译 OA 后端（`CGO_ENABLED=0 GOOS=linux GOARCH=amd64`）；
4. 构建 `xinbo-oa:local` 镜像；
5. 启动官方底座的 mongo / minio，再用 **compose override** 启动 OA 服务（不改官方 compose 文件）；
6. 轮询 `/oa/api/v1/healthz` 直到通过。

**为什么用 override**：`deploy/docker-compose.oa.yaml` 只定义 `xinbo-oa` 一个服务，叠加在官方 compose 上。官方升级底座时不会覆盖我们的改动，两边互不污染。

**前端仍需单独一步**（前端不在 compose 里）：

```bash
cd /work/openim-docker
git clone https://github.com/openimsdk/openim-electron-demo.git
cp -r oa-custom/frontend-patch/* openim-electron-demo/
cd openim-electron-demo && pnpm install && pnpm dev
# 打开 http://127.0.0.1:5173
```

### dev / prod 差异

| 项 | dev（本机） | prod（服务器） |
|---|---|---|
| 密钥 | 脚本自动生成随机串 | 手动设置强密码，走密钥管理，绝不进 Git |
| OA 后端 | 本机编译 + `xinbo-oa:local` | 同左，或用 CI 构建镜像推仓库 |
| 前端 | `pnpm dev` 5173 热更新 | `pnpm build` 静态包 + nginx `/oa` 反代（不带尾斜杠） |
| chatToken secret | 必须与 chat 配置一致，否则登录态失效 | 同左，且用环境变量注入 |

> **风险提示**：`bootstrap` 生成的随机密钥仅适合本地开发。生产环境务必手动设置强密码，并确认 `XINBO_OA_TOKEN_SECRET` 与 chat 的 `config/chat-rpc-admin.yml` secret 一致。

---

## 三、手动部署（备用 / 理解原理）

> 一键脚本已封装下面的步骤；出问题或想搞清楚每一步时再看。

### 前置
- Go 1.27+、Node 18+、pnpm、Docker + Docker Compose
- 能访问项目使用的 MongoDB / MinIO / OpenIM 服务
- 本机端口 5173（前端）、10010（OA 后端）未被占用

### 第 1 步：拉官方底座

```bash
# 部署编排（官方）
git clone https://github.com/openimsdk/openim-docker.git
# 官方前端 demo（本仓库补丁要覆盖到它上面）
git clone https://github.com/openimsdk/openim-electron-demo.git
```

官方前端 demo 的基线 commit：`62d7ca7`（fix: resolve lint issues and stabilize Electron e2e）。
升级官方版本时，注意 `frontend-patch/` 里的改动可能需要重新对账，见 `CHANGES.md`。

### 第 2 步：覆盖 OA 补丁

```bash
# 把本仓库 frontend-patch/ 下的所有文件覆盖到 openim-electron-demo/
cp -r oa-custom/frontend-patch/* openim-electron-demo/
```

> Windows PowerShell 用：`Copy-Item -Recurse -Force oa-custom\frontend-patch\* openim-electron-demo\`

### 第 3 步：配置环境变量

```bash
# 根 .env（部署编排 + OA 后端）
cp oa-custom/config-template/oa.env.example <openim-docker>/.env
# 把所有 <CHANGE_ME_*> 换成真实值，尤其是各类密码和 token secret

# 前端
cp oa-custom/config-template/frontend.env.local.example <openim-electron-demo>/.env.local
```

**安全红线**：真实 `.env` / `.env.local` 绝不提交到 Git；`XINBO_OA_TOKEN_SECRET` 必须与 chat 的 `config/chat-rpc-admin.yml` 里 secret 一致，否则 chatToken 校验不过。

### 第 4 步：编译并启动 OA 后端

```bash
cd oa-custom/backend
# 必须带这三个变量，否则容器 Restarting 且无日志（踩过的坑）
CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o bin/oa-api ./cmd/oa-api
# 用项目里的 Dockerfile 构建镜像后，由 docker-compose 编排启动
# 本机校验：
curl http://127.0.0.1:10010/oa/api/v1/healthz
```

### 第 5 步：启动前端

```bash
cd openim-electron-demo
pnpm install
pnpm dev            # 或项目脚本里的 dev-web
# 打开 http://127.0.0.1:5173
```

### 第 6 步：跑回归验证

```bash
# 接口/UI 回归脚本在 oa-custom/scripts/ 下，需先配好测试账号与 token
node oa-custom/scripts/oa_e2e_check.js           # 日报链路
node oa-custom/scripts/oa_team_attendance_check.js  # 团队出勤
node oa-custom/scripts/oa_leave_makeup_api_check.js # 请假补卡
```

完整脚本清单和账号见 `docs/OA测试账号与权限说明.md`。

**脚本所需环境变量**（脚本已脱敏，密钥不写死在文件里）：

```bash
export OA_TOKEN_SECRET=<和 .env 里 XINBO_OA_TOKEN_SECRET 一致>
export MONGO_PASSWORD=<和 .env 里 MONGO_PASSWORD 一致>
# UI 脚本若不用 playwright 自带 chromium，可指定本机浏览器：
export CHROME_PATH=/path/to/chrome
```

脚本依赖 `playwright-core`（`pnpm add -D playwright-core`），UI 脚本会输出到 `output/` 目录（已 gitignore）。

---

## 四、开发约定（必读）

1. **先全局设计，后写代码**：每个功能开工前回答 8 条检查——数据表、记录表先行、四视角（本人/组长/领导/HR）、上下游消费、统计口径唯一、状态机、边界、测试文档同步。详见 `docs/OA剩余开发清单与排期.md` 开头。
2. **权限统一**：凡是「谁能看谁的数据」，一律走后端 `visibleUserIDs(ctx, uid, scope)`，不要在新接口里另写角色判断。
3. **不写死演示文案**：公司名、地址、打卡点不得硬编码；默认不预设公司地址。
4. **不要假数据装真**：待办、打卡状态、定位、照片必须来自真实接口。
5. **提交/打卡/申请类功能**：先建不可变记录表，再做录入 UI。
6. **统计口径只写一份**：页面、报表、CSV 必须来自同一函数（`monthStatOf`）。

---

## 五、Git 协作规范

```bash
# 分支
main          # 可交付版本
dev           # 日常集成
feature/xxx   # 功能分支，从 dev 拉
fix/xxx       # 修复分支

# 提交信息
feat: 新增请假审批
fix: 修复团队报表口径不一致
docs: 更新排期文档
test: 补团队出勤回归
```

- 先 pull 再 push，禁止强推 main/dev。
- 每个功能 PR 必须附带：回归脚本结果 + 文档更新。
- 密钥、token、真实 `.env` 一律不提交。

---

## 六、部署环境差异（补充）

| 项 | dev（本地） | prod（部署） |
|---|---|---|
| 前端 | vite dev 5173，`vite.web.config.ts` 同源代理 | `pnpm build` 产物到静态目录，nginx `/oa` 反代不带尾斜杠 |
| 后端 | 本机编译 10010 | Docker 镜像 `xinbo-oa:local`，`XINBO_OA_PORT` |
| 密钥 | 模板填本地值 | 走环境变量/密钥管理，绝不进镜像 |
| 备份 | 无 | `mongodump` 每日 + 保留 7 天 |

---

## 七、常见坑

- Go 构建漏 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64` → 容器 Restarting 且无日志。
- MinIO 桶名必须 ≥3 字符（`oa` 会报错），本项目用 `xinbo-oa`。
- nginx `proxy_pass` 带尾斜杠会剥掉 `/oa` 前缀 → 生产 404，必须不带斜杠并 reload。
- 前端 `onError` 内联回调会导致 `useEffect` 无限请求 → 用 `useRef` + `useCallback` + `reqId`。
- flex 布局裁切 → 子项要加 `min-height:0`。
- 一键脚本必须在**官方底座同级目录**执行（本仓库是它的子目录），否则 compose 找不到官方文件；可用 `OA_COMPOSE` 显式指定。
- 生成的 `.env` 若改了 chat 配置里的 secret，必须同步改 `XINBO_OA_TOKEN_SECRET`，否则登录态校验失败、接口全部 401。
- Windows 上 Go 交叉编译必须带 `CGO_ENABLED=0 GOOS=linux GOARCH=amd64`；GOPROXY 不通时设 `GOPROXY=https://goproxy.cn,direct`。
