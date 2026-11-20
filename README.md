# OpenIM OA 二开 · 协作仓库

> **clone 本仓库 + 一条命令即可部署**：服务编排（compose/config）和完整前端源码都已打包进来，clone 本仓库即可，无需再拉其他代码。
> 自建业务代码在 `backend/`；`base/` 和 `frontend/` 是随仓库附带的底座与前端快照。

## 先看这两份

| 想干什么 | 看哪份 |
|---|---|
| **这套系统现在有什么**：13 个模块、45 个接口、9 张数据表、角色权限矩阵、还没做的部分 | **[docs/OA功能清单-已开发.md](docs/OA功能清单-已开发.md)** |
| **怎么把它跑起来**：clone + 一条命令、生产配置、故障排查 | **[DEPLOY.md](DEPLOY.md)** |
| **团队协作**：改完代码怎么交付、怎么拉别人的改动、常见坑 | **[docs/仓库开发流程.md](docs/仓库开发流程.md)** |
| 测试账号、谁登录能看什么 | [docs/OA测试账号与权限说明.md](docs/OA测试账号与权限说明.md) |
| 打卡 / 考勤 / 异常 / 审批的详细设计 | [docs/打卡功能-详细设计.md](docs/打卡功能-详细设计.md) |
| **Windows/macOS 桌面端**：怎么用、怎么打包、怎么分发 | **[docs/桌面端部署与分发.md](docs/桌面端部署与分发.md)** |

---

## 一、这个仓库装了什么

| 目录 | 内容 | 来源 |
|---|---|---|
| `backend/` | 完整 OA 后端服务（Go/Gin/MongoDB/MinIO） | 自建 |
| `base/` | 服务编排 `docker-compose.yaml` + `config/` | 随仓库附带的编排快照 |
| `frontend/` | **完整前端源码，已含全部 OA 页面**，可直接构建镜像 | 已应用 `frontend-patch/` 的改动 |
| `frontend-patch/` | OA 页面与改动文件清单（对账用，`frontend/` 已应用） | 前端改动的原始补丁记录 |
| `frontend-custom/` | **管理后台（11002）「新博」品牌覆盖**：`admin/` 覆盖产物 + `brand/` 图标源与生成图 | 由官方 admin 镜像产物打补丁生成，可重复生成 |
| `docs/` | OA 设计文档、排期、账号说明、日报 | 自建 |
| `scripts/` | OA 接口/UI 回归脚本 + 前端双向同步脚本 | 自建 |
| `config-template/` | 脱敏的环境变量模板 | 自建 |
| `deploy/` | **一键部署脚本 + compose override** | 自建 |

**不在本仓库**：
- 真实 `.env`、`.env.local`（含密钥，禁止入库；由部署脚本生成）
- `node_modules/`、`dist/`、`bin/` 等构建产物
- OpenIM 业务镜像（`openim-server`/`chat`：由镜像仓库拉取，需能访问镜像仓库）

---

## 二、仓库即唯一工作目录（协作必读）

**团队所有开发都在本仓库内完成**，不再有"本机大仓 + 协作仓"两份副本。`backend/`、`frontend/` 就是唯一源码，改完直接 commit/push，同事 pull 后一键部署即是最新版。

仓库目录说明：

| 目录 | 说明 |
|---|---|
| `backend/` | OA 后端 Go 源码（Docker 镜像内编译，本地无需装 Go） |
| `frontend/` | OA 前端 + Electron 桌面端完整工程（含 `package.json`、`electron-builder.json5`、`build:win` 脚本） |
| `base/` | 官方底座编排与配置快照（拉镜像，不碰代码） |
| `deploy/` | 一键部署脚本（bootstrap / build / up / verify 等） |
| `frontend-custom/` | 管理后台（11002）新博品牌覆盖文件，随 bootstrap 自动挂载 |
| `scripts/` | 回归脚本 + 品牌脚本（可移植，自动找依赖/浏览器） |
| `docs/patches/` | 官方 IM 底座二开补丁存档（不参与构建，仅保底） |
| `output/` | 回归截图/附件，运行时自动生成，不入库 |

`node_modules/`、`dist/`、`release/`、`.env*` 都不进 git：clone 后本地装依赖、构建即可。

> **历史遗留**：早期团队在本机 `openim-docker-latest/src/` 大仓开发，靠 `scripts/sync-frontend.mjs` 双向同步到仓库——这条路径已废弃，`src/` 退役。官方底座的少量二开改动已存档到 `docs/patches/openim-official/`。若你仍持有旧的大仓副本，请勿再从它同步覆盖本仓库。

### 同事 clone 后怎么开发

```bash
git clone https://github.com/liang-mg/openim.git && cd openim
cd frontend
corepack pnpm i          # 装依赖，回归脚本会自动从这里找 playwright
npx vite build           # 构建 Web + Electron 产物
# 后端改 backend/ 下的 Go 代码；本地无需装 Go，一键命令走 Docker 构建
bash ../deploy/deploy.sh bootstrap
```

### 回归脚本（同事机器直接可跑）

```bash
cd openim
node scripts/oa_attendance_ui_check.js   # 需 5173/10010 已启动
```

脚本会**自动探测** playwright-core 和系统 Chrome，也支持显式覆盖：

| 环境变量 | 作用 |
|---|---|
| `PLAYWRIGHT_CORE=<目录>` | 指定 playwright-core 路径（默认从 `frontend/node_modules` 或本机大仓找） |
| `CHROME_PATH=<exe>` | 指定浏览器；不设则找系统 Chrome，找不到用 playwright 自带 chromium |
| `OA_OUTPUT_DIR=<目录>` | 截图输出目录，默认 `openim/output/` |

### 日常协作流程（改完 → 大家都能跑）

只有一条主线，不分本机/仓库：

**你改完代码要交付：**
```bash
cd openim
git pull --ff-only                 # 先拉，避免和同事的改动分叉
# 改 backend/ 或 frontend/ 下的代码
git add -A && git commit -m "说明改了什么"
git push origin main
```

**同事拿到你的改动：**
```bash
cd openim
git pull --ff-only
bash deploy/deploy.sh build        # 重建后端/前端镜像（改了代码必须 build）
bash deploy/deploy.sh up           # 重启生效
```

**你拿到同事的改动：** 同上，先 `git pull --ff-only`，改了代码就 `build` + `up`。

> ⚠️ 拉取后**只 `up` 不 `build` 跑的还是旧镜像**——Go/前端代码都编译进镜像了。这是最容易踩的坑。

**桌面端 exe**：在 `frontend/` 目录执行 `corepack pnpm build:win`，产物在 `frontend/release/`。改了前端代码记得先重新构建。

完整流程与分支约定见 [docs/仓库开发流程.md](docs/仓库开发流程.md)。

---

## 三、部署

**看 [DEPLOY.md](DEPLOY.md)** —— clone 一次 + 一条命令，前后端全起来（本地只需 Docker）。

```bash
git clone https://github.com/liang-mg/openim.git && cd openim
bash deploy/deploy.sh bootstrap
# OA 网页版:   http://127.0.0.1:5173
# 管理后台:    http://127.0.0.1:11002  （已是「新博」品牌）
```

`bootstrap` 会同时拉起后端、OA 网页版、管理后台三个服务，管理后台的品牌覆盖（`frontend-custom/`）随仓库一起分发，同事无需手动打补丁。

日常运维、生产配置、功能开关、故障排查都在 DEPLOY.md，本文不重复，避免两边不同步。

### 已实现的 OA 功能

打卡（真实定位 + 拍照）· 出勤记录（我的/团队/报表 + CSV）· 日报与点评审阅 · 请假与补卡审批 ·
**考勤异常扫描与处理** · **考勤规则配置（员工与权限页）** · **审批中心（四类待办一处处理）** ·
**日报提交率与一键催交** · 站内通知（可选 IM 推送）· 员工与权限管理。

**完整功能表见 [docs/OA功能清单-已开发.md](docs/OA功能清单-已开发.md)**：13 个模块逐项写明页面入口、能做什么、45 个接口、9 张数据表、角色能力矩阵、回归脚本，以及还没做的部分。

### Windows / macOS 桌面端

前端源码本身是 Electron 工程，可打成桌面安装包。后端地址在打包时内置（`src/utils/serverConfig.ts` 的 `BUILTIN_SERVER_HOST`），同事安装后**直接填账号密码即可登录**，无需配置（Web 端行为不变）。换服务器由打包方改常量重新打包，见 `docs/桌面端部署与分发.md`。

```bash
cd frontend
corepack pnpm typecheck
npx vite build                              # 先构建 dist + dist-electron
node scripts/electron-build.mjs --skip-build --win --x64    # Windows NSIS
node scripts/electron-build.mjs --skip-build --mac --arm64  # macOS（Apple 芯片）
```

产物在 `frontend/release/Base/3.8.3/`。`--skip-build` 用于复用已构建产物、避开重复构建；沙箱环境构建用 `npx vite build`（vite 配置已设 `emptyOutDir:false`）。使用与分发细节见 [docs/桌面端部署与分发.md](docs/桌面端部署与分发.md)。

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

- Go 编译已内置到 `backend/Dockerfile` 多阶段构建，本地无需安装 Go。
- MinIO 桶名必须 ≥3 字符（`oa` 会报错），本项目用 `xinbo-oa`。
- nginx `proxy_pass` 带尾斜杠会剥掉 `/oa` 前缀 → 生产 404，必须不带斜杠并 reload。
- 前端 `onError` 内联回调会导致 `useEffect` 无限请求 → 用 `useRef` + `useCallback` + `reqId`。
- flex 布局裁切 → 子项要加 `min-height:0`。
- 一键脚本从仓库自带的 `base/` 读取服务编排；如需改用外部编排文件，可用 `OA_COMPOSE` 显式指定。
- 生成的 `.env` 若改了 chat 配置里的 secret，必须同步改 `XINBO_OA_TOKEN_SECRET`，否则登录态校验失败、接口全部 401。
- GOPROXY 不通时设 `GOPROXY=https://goproxy.cn,direct`，`deploy.sh build` 会透传给镜像构建。
- **桌面端登录页不显示「服务器地址」输入框 / 点登录没反应**：多半是 preload 加载失败、`window.electronAPI` 未注入。典型原因是 preload 引用的公共模块里读了 `app.isPackaged`（preload 上下文没有 `app`）而抛错。排查：带 `--remote-debugging-port=9223` 启动，用浏览器打开 `http://127.0.0.1:9223/json` 拿页面 WebSocket 地址，连上看 Runtime 异常。修复见 `CHANGES.md` 第六节。
- **桌面端服务器地址是打包时内置的**：登录页只填账号密码，不需要也不允许输入服务器地址。要换后端地址，改 `frontend/src/utils/serverConfig.ts` 的 `BUILTIN_SERVER_HOST` 后重新打包安装；地址派生规则用 `node scripts/oa_desktop_config_check.js` 验证（32 项）。
