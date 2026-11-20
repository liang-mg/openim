# OpenIM OA 二开 · 协作仓库

> **clone 本仓库 + 一条命令即可部署**：服务编排（compose/config）和完整前端源码都已打包进来，clone 本仓库即可，无需再拉其他代码。
> 自建业务代码在 `backend/`；`base/` 和 `frontend/` 是随仓库附带的底座与前端快照。

---

## 一、这个仓库装了什么

| 目录 | 内容 | 来源 |
|---|---|---|
| `backend/` | 完整 OA 后端服务（Go/Gin/MongoDB/MinIO） | 自建 |
| `base/` | 服务编排 `docker-compose.yaml` + `config/` | 随仓库附带的编排快照 |
| `frontend/` | **完整前端源码，已含全部 OA 页面**，可直接构建镜像 | 已应用 `frontend-patch/` 的改动 |
| `frontend-patch/` | OA 页面与改动文件清单（对账用，`frontend/` 已应用） | 前端改动的原始补丁记录 |
| `docs/` | OA 设计文档、排期、账号说明、日报 | 自建 |
| `scripts/` | OA 接口/UI 回归脚本（21 个） | 自建 |
| `config-template/` | 脱敏的环境变量模板 | 自建 |
| `deploy/` | **一键部署脚本 + compose override** | 自建 |

**不在本仓库**：
- 真实 `.env`、`.env.local`（含密钥，禁止入库；由部署脚本生成）
- `node_modules/`、`dist/`、`bin/` 等构建产物
- OpenIM 业务镜像（`openim-server`/`chat`：由镜像仓库拉取，需能访问镜像仓库）

---

## 二、部署

**看 [DEPLOY.md](DEPLOY.md)** —— clone 一次 + 一条命令，前后端全起来（本地只需 Docker）。

```bash
git clone https://github.com/liang-mg/openim.git && cd openim
bash deploy/deploy.sh bootstrap
# 打开 http://127.0.0.1:5173
```

日常运维、生产配置、功能开关、故障排查都在 DEPLOY.md，本文不重复，避免两边不同步。

### 已实现的 OA 功能

打卡（真实定位 + 拍照）· 出勤记录（我的/团队/报表 + CSV）· 日报与点评审阅 · 请假与补卡审批 ·
**考勤异常扫描与处理** · **考勤规则配置（员工与权限页）** · **审批中心（四类待办一处处理）** ·
**日报提交率与一键催交** · 站内通知（可选 IM 推送）· 员工与权限管理。

**完整功能表见 [docs/OA功能清单-已开发.md](docs/OA功能清单-已开发.md)**：13 个模块逐项写明页面入口、能做什么、45 个接口、9 张数据表、角色能力矩阵、回归脚本，以及还没做的部分。
同事接手、联调、验收都先看这份，比读设计文档快。

## 三、开发约定（必读）

1. **先全局设计，后写代码**：每个功能开工前回答 8 条检查——数据表、记录表先行、四视角（本人/组长/领导/HR）、上下游消费、统计口径唯一、状态机、边界、测试文档同步。详见 `docs/OA剩余开发清单与排期.md` 开头。
2. **权限统一**：凡是「谁能看谁的数据」，一律走后端 `visibleUserIDs(ctx, uid, scope)`，不要在新接口里另写角色判断。
3. **不写死演示文案**：公司名、地址、打卡点不得硬编码；默认不预设公司地址。
4. **不要假数据装真**：待办、打卡状态、定位、照片必须来自真实接口。
5. **提交/打卡/申请类功能**：先建不可变记录表，再做录入 UI。
6. **统计口径只写一份**：页面、报表、CSV 必须来自同一函数（`monthStatOf`）。

---

## 四、Git 协作规范

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

## 五、部署环境差异（补充）

| 项 | dev（本地） | prod（部署） |
|---|---|---|
| 前端 | vite dev 5173，`vite.web.config.ts` 同源代理 | `pnpm build` 产物到静态目录，nginx `/oa` 反代不带尾斜杠 |
| 后端 | 本机编译 10010 | Docker 镜像 `xinbo-oa:local`，`XINBO_OA_PORT` |
| 密钥 | 模板填本地值 | 走环境变量/密钥管理，绝不进镜像 |
| 备份 | 无 | `mongodump` 每日 + 保留 7 天 |

---

## 六、常见坑

- Go 编译已内置到 `backend/Dockerfile` 多阶段构建，本地无需安装 Go。
- MinIO 桶名必须 ≥3 字符（`oa` 会报错），本项目用 `xinbo-oa`。
- nginx `proxy_pass` 带尾斜杠会剥掉 `/oa` 前缀 → 生产 404，必须不带斜杠并 reload。
- 前端 `onError` 内联回调会导致 `useEffect` 无限请求 → 用 `useRef` + `useCallback` + `reqId`。
- flex 布局裁切 → 子项要加 `min-height:0`。
- 一键脚本从仓库自带的 `base/` 读取服务编排；如需改用外部编排文件，可用 `OA_COMPOSE` 显式指定。
- 生成的 `.env` 若改了 chat 配置里的 secret，必须同步改 `XINBO_OA_TOKEN_SECRET`，否则登录态校验失败、接口全部 401。
- GOPROXY 不通时设 `GOPROXY=https://goproxy.cn,direct`，`deploy.sh build` 会透传给镜像构建。
