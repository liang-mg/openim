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

---

## 六、桌面端登录无反应修复（2026-11-20）

- **现象**：桌面端登录页填了账号密码，点「登录」没反应；登录页**不显示「服务器地址」输入框**。
- **根因**：`electron/utils/index.ts` 导出 `isProd = app.isPackaged`，但该模块同时被主进程和 **preload** 引用。preload 上下文里 `app` 是 `undefined`，读 `app.isPackaged` 抛 `TypeError: Cannot read properties of undefined (reading 'isPackaged')`，导致整个 preload 加载失败 → `window.electronAPI` 未注入 → `isElectronRuntime()` 返回 false（不显示服务器地址框）、登录请求打到 `file://` 地址而失败。
- **定位方法**：带 `--remote-debugging-port` 启动桌面端，用 CDP 读 Runtime 异常，捕获到 `Unable to load preload script` + `isPackaged` TypeError。
- **修复**：`isProd` 改为不依赖 `app` 的惰性判断——主进程用 `app.isPackaged`，preload 用 `!process.defaultApp` 兜底：
  ```ts
  export const isProd = (() => {
    try { if (app && typeof app.isPackaged === "boolean") return app.isPackaged; } catch (_) {}
    return !process.defaultApp;
  })();
  ```
- **验证**（CDP 自动化，win-unpacked）：修复后 `electronAPI=object`、服务器地址输入框出现、preload 报错 0；填入 `127.0.0.1` + `12345678003` + `Xinbo@2026` 点登录，成功跳转到 `#/chat` 并显示「刘洋 / 消息 / 通讯录 / 工作台」。
- 注意：登录页**必须填服务器地址**（桌面端生产模式），填后端所在 IP/域名；不填则 `onFinish` 直接 return。

---

## 七、登录页去掉服务器地址输入（2026-11-20）

- 用户反馈：让普通同事在登录页填服务器地址不合理（不知道填什么）。改为**完全内置写死**方案。
- `src/utils/serverConfig.ts`：新增 `BUILTIN_SERVER_HOST` 常量（默认 `"127.0.0.1"`）；桌面端生产模式用 `parseHost(host ?? BUILTIN_SERVER_HOST)`，不再读 `localStorage` 的用户输入。换服务器 = 改这一行 + 重新打包。
- `src/pages/login/LoginForm.tsx`：删除服务器地址表单项、`needServerHost` 分支、`getServerHost`/`setServerHost` 调用；登录页现在只有账号 + 密码。
- `scripts/oa_desktop_config_check.js`：新增源码一致性断言（内置常量存在、桌面模式用内置地址、登录页无 serverHost 字段/无 needServerHost），共 **32/32 通过**。
- CDP 端到端验证（win-unpacked）：登录页 `hasServerLabel=false`、inputs 仅账号+密码、`electronAPI=object`、preload 报错 0；填 `12345678003`/`Xinbo@2026` 直接登录成功进入 `#/chat`。
- 文档同步：`docs/桌面端部署与分发.md`、`README.md` 改为"地址内置、打包方改常量"的说明。

---

## 八、修复桌面端全部 OA 接口 404 / 报告查阅判无权（2026-11-20）

- 用户反馈（桌面端）：刘洋（role=manager，组长）报告查阅页显示「独立页面 / 报告查阅仅组长与领导可用」，出勤记录页弹 `Request failed with status code 404`。
- **根因**：后端 OA 路由注册在 `/oa/api/v1`（`internal/api/router.go` 的 `r.Group("/oa/api/v1")`）。Web 端靠 vite 代理的 `/oa` 前缀补齐，所以正常；桌面端标准端口模式直连 `127.0.0.1:10010` 时，`resolveServerURLs()` 派生出的 `oaApi` 是 `http://host:10010/api/v1`——**漏了 `/oa`**，导致所有 OA 接口 404。`/me` 404 → `getMe()` 抛错 → `me=null` → `canView=false` → 报告查阅误判为无权。
- **证据**：`curl http://127.0.0.1:10010/api/v1/me` → 404；`curl http://127.0.0.1:10010/oa/api/v1/me` → 200（业务 401=未带 token，属正常）。数据库 `oa_employee` 中刘洋 `role=manager` 正确，排除数据问题。
- **修复**：`serverConfig.ts` 标准端口模式 `oaApi` 改为 `${http(PORTS.oa)}/oa/api/v1`（反代模式本来就是 `/oa/api/v1`，无需改）。一处修复覆盖全部 OA 调用（所有接口都基于 `oaApi`）。
- **回归**：`oa_desktop_config_check.js` 原断言写死了错误值 `...:10010/api/v1`，等于把 bug 固化了；改为期望 `/oa/api/v1` 并新增源码断言，镜像实现同步修正，**33/33 通过**。
- **验证**（CDP + win-unpacked，刘洋登录）：报告查阅徽章显示「组长视角」、列表正常加载；出勤记录页数据正常、网络错误 0；`checkin/report` 等接口直连均 200。

---

## 九、品牌名「新搏」统一改为「新博」（2026-11-20）

- 用户要求：品牌字「搏」改为「博」，全仓库统一，单个「搏」字（如 emoji 注释「搏动」）不动。
- **文本替换**（共 52 个文件）：`electron-builder.json5`（productName/shortcutName）、`index.html` title、`package.json` description、`windowManage.ts` 标题、`config/index.ts` APP_NAME、`i18n/zh.json` 欢迎语与二维码提示、全部 `docs/*.md`、安卓 `strings.xml`/`MainActivity.java`、uniapp `manifest.json`/`pages.json`、`docker-compose.frontend.yaml`、`frontend-custom/` 产物、`patch_brand.js` / `patch_brand_admin.js` 品牌脚本（含 unicode 转义 `\u640F`→`\u535A`，并保留旧值 `\u640F` 兼容规则以纠正历史产物）。
- **图标重制**：`make_brand_icons.js` 的源 `icon-source.html` / `logo-vertical-source.html` 改为「新博」后重新渲染 icon-512/192/…；用 PIL 生成 Electron 的 `icon.png`(256)/`mac_icon.png`(512)/`icon.ico`(多尺寸)，覆盖 `public/icons/` 与 `dist/icons/`；`docs/brand/logo-xinbo.png` 替换为新图标。
- **截图更新**：三张旧版登录截图（含已删除的邮箱/验证码）用当前真实登录页重拍覆盖（显示「欢迎来到新博」「新博 v3.8.3」）。
- **验证**：CDP 实测新包 title=「新博」、欢迎语「欢迎来到新博」、版本「新博 v3.8.3」、旧品牌 `old=false`；全仓文本无「新搏」残留（排除 memory 历史日志与 emoji「搏动」）。
- 新包：`新博_3.8.3.exe`（15:23，82.4MB）；旧 `新搏_3.8.3.exe` 移入 `release/Base/3.8.3/deprecated/`，避免误点。
