# 前端改动清单

> 基线 commit：`62d7ca7`（fix: resolve lint issues and stabilize Electron e2e）
> 说明：`frontend-patch/` 记录了对前端基线源码的全部改动；`frontend/` 已是应用后的完整源码。
> 「新增」= 本次加入的页面/模块；「修改」= 在基线源码上改动的文件。

---

## 一、新增文件 / 目录

| 路径 | 说明 |
|---|---|
| `src/api/oaApi.ts` | OA 全部接口封装（打卡、出勤、团队、报表、请假、补卡、日报、文件、管理、工作台） |
| `src/pages/checkin/` | 拍照打卡页（真实 GPS + 服务端判位 + 照片水印上传） |
| `src/pages/attendance/` | 出勤记录页（我的/团队/报表/全公司四档 + 月历 + CSV 导出） |
| `src/pages/leave/` | 请假补卡页（我的申请/待我审批/已处理） |
| `src/pages/approvals/` | 审批中心（待我处理/我发起的/已处理/日报提交 + 催交 + 异常申诉） |
| `src/pages/report/` | 工作报告页（日报化：提交、附件、2h 撤回、补写） |
| `src/pages/report-review/` | 领导查阅页（待查阅/已归档、两级点评） |
| `src/pages/oa-admin/` | 员工与权限管理页（管理员） |
| `src/pages/work/` | 工作台（真实待办/打卡卡） |
| `src/pages/mine/` | 我的（OA 入口） |
| `src/layout/MobileTabBar/` | 移动端底部导航 |
| `vite.web.config.ts` | Web 构建配置，同源代理 `/api`、`/oa`、`/chat`、`/msg_gateway` |
| `src/utils/serverConfig.ts` | 桌面端运行时服务器地址配置（一个 host 派生 6 个服务地址；Web 端走同源） |
| `scripts/oa_desktop_config_check.js` | 桌面端地址派生回归（27 条用例） |
| `docs/桌面端-运行时服务器配置设计.md` | 桌面端改造的全局性设计（8 条清单 + 地址规则 + 兼容方案） |
| `docs/桌面端部署与分发.md` | Windows/macOS 安装包的使用、打包与分发说明 |

---

## 二、改动的前端文件

| 路径 | 改动摘要 |
|---|---|
| `src/pages/login/LoginForm.tsx` | 登录改为「账号（手机号）+ 密码」，移除邮箱/验证码；桌面端增加「服务器地址」输入框 |
| `src/pages/login/index.tsx` | 去掉登录方式状态；桌面端卡片高度适配新增的服务器输入框 |
| `src/api/login.ts` | axios baseURL 改为运行时解析（桌面端读登录页填的 host） |
| `src/api/oaApi.ts` | OA baseURL 改为运行时解析；CSV 下载用完整地址 |
| `src/utils/request.ts` | axios 工厂支持惰性 baseURL（函数），每次请求动态解析 |
| `vite.config.ts` | `emptyOutDir: false`（沙箱环境避免批量删除超时） |
| `scripts/electron-build.mjs` | 新增 `--skip-build` 复用产物；用 node 直启 electron-builder cli，不依赖 .cmd |
| `index.html` | 页面标题/图标等品牌化 |
| `src/App.tsx` | 接入 OA 全局配置 |
| `src/api/imApi.ts` | IM 接口适配（token 头、base 地址） |
| `src/config/index.ts` | 环境配置读取 |
| `src/i18n/resources/en.json` | 新增 OA 文案（英文） |
| `src/i18n/resources/zh.json` | 新增 OA 文案（中文） |
| `src/layout/LeftNavBar/index.tsx` | 左侧导航加 OA 菜单项（打卡/出勤/日报/查阅/管理），管理员项按 `is_admin` 动态拼 |
| `src/layout/MainContentLayout.tsx` | 主内容区适配 OA 页面 |
| `src/layout/useGlobalEvents.tsx` | 全局事件调整 |
| `src/pages/chat/ConversationSider/index.tsx` | 会话列表适配 |
| `src/pages/chat/queryChat/ChatHeader/index.tsx` | 聊天头适配 |
| `src/pages/login/LoginForm.tsx` | 登录流程适配（验证码登录） |
| `src/pages/login/index.tsx` | 登录页调整 |
| `src/routes/index.tsx` | 注册 OA 路由（`/checkin`、`/attendance`、`/leave`、`/report`、`/report-review`、`/oa-admin`、`/work`） |
| `src/styles/global.scss` | 全局样式补充 |

---

## 三、更新前端基线时的对账步骤

1. 更新前端基线后，先看上述「修改」文件是否有冲突。
2. 重点检查 `src/routes/index.tsx`、`src/layout/LeftNavBar/index.tsx`、`src/App.tsx`——基线更新这几个文件时我们的 OA 入口容易被冲掉。
3. `src/api/oaApi.ts` 依赖 `imApi.ts` 的 token/base 地址，基线若改鉴权方式需同步适配。
4. 对账后跑 `oa-custom/scripts/oa_*_check.js` 全套回归，确认无回退。

---

## 四、桌面端打包依赖修复（2026-11-20）

- `frontend/scripts/electron-build.mjs`：`ensurePnpmTopLevelLinks` 不再硬编码包名，改为对 dry-run 算出的**全部运行时依赖闭包**自动补 pnpm 顶层链接。此前 `conf`/`dot-prop`/`@babel/runtime` 等传递依赖没有顶层链接，未进 asar，启动报 `Cannot find module`。
- `scripts/oa_electron_package_check.js`（新增）：打包完整性回归，逐个验证运行时依赖在 asar 内有物理文件，并单独点名易漏模块。对最新 Windows 包验证结果 **39/39 通过**。
  - 用法：先在开发机大仓打包，再 `node scripts/oa_electron_package_check.js <app路径>`；`<app路径>` 为 `src/openim-electron-demo` 的绝对路径（也支持 `OA_ELECTRON_APP` 环境变量）。
- 打包期 `file source doesn't exist ... node_modules/rxjs` 是无害告警：`rxjs` 不在运行时依赖清单、也无代码引用，可忽略。

---

## 五、协作可移植性修复（2026-11-20）

- `scripts/lib/playwright-env.js`（新增）：统一管理 playwright-core 加载、截图输出目录、Chrome 路径，支持 `PLAYWRIGHT_CORE` / `CHROME_PATH` / `OA_OUTPUT_DIR` 覆盖。
- 8 个 UI 回归脚本：去掉写死的 `D:/work/...`、`C:/Program Files/...` 路径，改走公共库；同事 clone 后只需在 `frontend/` 执行 `pnpm i` 即可跑。实跑 `oa_attendance_ui_check.js` 验证 **14/14 通过**。
- `scripts/sync-frontend.mjs`（新增）：本机大仓 `src/openim-electron-demo` 与仓库 `frontend/` 双向同步（status / to-repo / to-local，支持 --dry-run），只覆盖源码、不删产物和密钥。
- `README.md`：新增「二、本机目录与仓库对照（协作必读）」，说明两边目录映射、为什么产物不入库、同事开发/回归/同步流程；后续章节重新编号。
