# 新博 OA · 移动端（uni-app / Vue3）

与 `frontend/`（PC 端，React）保持**功能与样式一致**的移动端实现。
最终产物是 Android APK（以及可选的 H5 / 小程序），并为后续接 OpenIM 原生 SDK
与离线推送做好铺垫。

> 迁移策略与决策变更见 [`docs/移动端-uniapp迁移方案.md`](../docs/移动端-uniapp迁移方案.md)。

---

## 快速开始

```powershell
cd uniapp
npm install
npm run dev:h5      # http://127.0.0.1:5180（5174 常被其他项目占用）
```

需要后端在跑（OA 接口 `127.0.0.1:10010`、MongoDB `27017`）。
本机已有 `.local/bin/oa-api.exe` 与 `.local/mongodb/...`，启动命令见仓库根 `docs/`。

### 本地没有 IM 服务怎么登录

账号密码登录会调 IM 的 `/chat/account/login`，IM 没起时用不了。
`.env.dev.local`（已 gitignore）里配一个 `VITE_DEV_TOKEN`，登录页会多出
「本地联调进入（跳过 IM 登录）」按钮：

```powershell
# 生成 token（key 必须与后端 OA_TOKEN_SECRET 一致）
node ../.local/mint-token.js
```

把输出填到 `.env.dev.local` 的 `VITE_DEV_TOKEN=`，再填 `VITE_DEV_USER_ID=2158780278`。
模板见 [`.env.dev.local.example`](.env.dev.local.example)。

---

## 环境文件

| 文件 | 是否提交 | 用途 |
|---|---|---|
| `.env` | ✅ | 所有环境通用（接口前缀、应用名） |
| `.env.development` / `.env.production` | ✅ | 标准 vite 模式文件 |
| `.env.dev` | ✅ | 本地开发默认值（端口、proxy 目标） |
| `.env.dev.local` | ❌ | 仅本机：临时 token、指向同事的后端 |
| `.env.dev.local.example` | ✅ | 上面那个文件的模板（占位符） |

加载顺序：`.env` → `.env.[mode]` → `.env.dev` → `.env.dev.local`（后者覆盖前者），
注入逻辑见 [vite.config.js](vite.config.js) 顶部。

**约定：前端代码里只写同源相对路径**（`/oa`、`/chat`、`/api`、`/msg_gateway`），
dev 由 vite proxy 转发，生产由 nginx 反代（规则与 `frontend/nginx/site.conf` 一致）。
这样同一份代码在 dev、浏览器、APK 里的请求路径完全相同。

---

## 目录约定

```
src/
├── api/
│   ├── oa.js          # OA 业务接口，与 frontend/src/api/oaApi.ts 一一对应（同名同参）
│   ├── auth.js        # 登录 / 登出（复用 IM 的 chatToken）
│   └── im/            # IM 适配层（H5=JS SDK / App=UTS 插件，无 mock）
├── components/        # 跨页面组件（oim-avatar / app-tabbar / page-shell）
├── config/index.js    # 运行时配置（读 env），HOME_PATH 等
├── pages/             # 页面，一个页面一个目录
├── static/            # 图片等静态资源（tabbar 图标从 PC 端复制）
├── store/user.js      # 用户与权限（pinia）
├── utils/             # request / storage / format
├── App.vue            # 全局样式与设计变量
├── pages.json         # 路由（新增页面必须在这里注册）
└── manifest.json      # App 打包配置（appid、权限）
```

### 三条硬约定

1. **接口不重复造**：PC 端有哪个函数，`api/oa.js` 里就叫什么名字、同样参数，
   方便逐行对账（三端一致性靠接口契约，不靠人眼）。
2. **权限只在展示层判断**：`is_admin`、`role` 来自 `/me`，真正的越权判断在后端
   （`visibleUserIDs` / 403），前端不信任何 id。
3. **跳转统一走 `utils/nav.js`**：后端给的是 PC 的 web 路由（`/report`），
   uni 页面是 `/pages/report/index`，直接塞给 `navigateTo` 会静默失败 —— 必须过一层映射。
3. **IM 走适配层**：页面不直接调 SDK。H5 用 `@openim/client-sdk`、App 用
   `unix-openim-sdk` UTS 原生插件，两者 API 不同，全部收在 `api/im/` 后面。

---

## 页面迁移状态

| 页面 | 路由 | PC 源文件 | 状态 |
|---|---|---|---|
| 登录 | `pages/login/index` | `pages/login/` | ✅ 完成（含本地联调登录） |
| 工作台 | `pages/work/index` | `pages/work/index.tsx` | ✅ 完成（真实数据） |
| 我 | `pages/mine/index` | `pages/mine/index.tsx` | ✅ 完成（含管理员入口显隐） |
| 消息 | `pages/message/index` | `pages/chat/ConversationSider` | ✅ 完成（真实 OpenIM 会话列表 + 搜索 + 未读 + 连接状态） |
| 通讯录 | `pages/contact/index` | `pages/contact/` | ✅ 完成（好友/群聊/新的朋友/群通知/添加好友/资料卡） |
| 新的朋友 | `pages/contact/new-friends/index` | `pages/contact/newFriends` | ✅ 完成（收到/发出、同意/拒绝、红点） |
| 添加好友 | `pages/contact/add-friend/index` | `pages/common/UserCardModal` | ✅ 完成（手机号/账号/用户ID 搜索、验证消息） |
| 用户资料 | `pages/contact/user-card/index` | `UserCardModal` | ✅ 完成（发消息/备注/删除好友） |
| 群通知 | `pages/group/notifications/index` | `pages/contact/groupNotifications` | ✅ 完成（加群申请同意/拒绝、红点） |
| 创建群聊 | `pages/group/create/index` | `CreateGroupModal` | ✅ 完成（选好友、群名） |
| 加入群组 | `pages/contact/add-group/index` | `SearchUserOrGroup` | ✅ 完成（按群ID搜索、申请加入） |
| 群设置 | `pages/group/settings/index` | `GroupSetting` | ✅ 完成（改名/公告/邀请/踢人/转让/退群/解散） |
| 邀请好友 | `pages/group/invite/index` | `GroupSetting` | ✅ 完成（排除已在群成员） |
| 聊天 | `pages/chat/index` | `pages/chat/queryChat/` | ✅ 完成（时间分隔、群聊昵称、分页加载更多、发送中/超时/失败重发、离线 outbox、断线重连、系统消息） |
| 拍照打卡 | `pages/checkin/index` | `pages/checkin/index.tsx` | ✅ 完成（定位 + 相机 + 水印 + 提交全链路联调） |
| 出勤记录 | `pages/attendance/index` | `pages/attendance/` | ✅ 完成（我的/团队/报表三档 + 成员月历抽屉 + CSV 导出） |
| 工作报告 | `pages/report/index` | `pages/report/index.tsx` | ✅ 完成（今天/昨天、草稿/提交/2h 撤回、锁定态；附件前端已通，本机无 MinIO 无法端到端验） |
| 请假补卡 | `pages/leave/index` | `pages/leave/index.tsx` | ✅ 完成（三档 + 请假/补卡两组 + 申请抽屉 + 撤销 + 审批；E2E 已验提交/撤销/审批） |
| 审批中心 | `pages/approvals/index` | `pages/approvals/index.tsx` | ✅ 完成（四档 + 四类待办 + 处理意见抽屉 + 提交率/催交；已用真实请假单走通同意流程） |
| 报告查阅 | `pages/report-review/index` | `pages/report-review/index.tsx` | ✅ 完成（组长点评上报 → 领导点评归档，两级链路真数据跑通；员工无权限提示） |
| 员工与权限 | `pages/oa-admin/index` | `pages/oa-admin/index.tsx` | ✅ 完成（考勤规则 + 搜索/部门/角色/含停用 + 添加编辑 + 停用启用；非管理员拦截） |

---

## 移动端渲染约定（写页面前必读）

PC 端代码直接搬到手机上会「溢出、滑不动、切换卡」。三条最容易踩的：

1. **不要用 `height:100vh` + 内层 `scroll-view` 做固定高度壳** —— 真机地址栏/键盘/安全区会改写视口。
   本项目约定：整页由文档流滚动，头部 `sticky`，底部 tabbar `fixed`，内容末尾加 `.page-bottom-space`。
2. **列表一律分页**（`onReachBottom`，单页 ≤ 30 条），不一次渲染全量。
3. **模板里不调函数**（`{{ fmt(x) }}`），计算放 `computed`；不用 `onPageScroll` 做吸顶/动画。

完整清单（含图片压缩、单位、动效、键盘与安全区、验收方法）见
[`docs/移动端-渲染与性能约定.md`](../docs/移动端-渲染与性能约定.md)。

---

### IM 适配层（`src/api/im/`）—— 已接真实 OpenIM，无 mock

三个 IM 页面只依赖 `src/api/im/index.js`，**不直接碰 SDK**。两套真实实现：

| 运行环境 | 实现 | 说明 |
|---|---|---|
| H5 / 浏览器 | `@openim/client-sdk`（JS SDK，WSS） | 与 PC 的 WASM SDK 连同一套 openim-server |
| App / APK | `unix-openim-sdk`（UTS 原生插件） | 本地消息库 + 原生长连接 + 离线推送基础 |

```
src/api/im/
├── index.js   连接状态机 + 事件广播 + 统一 Contract（页面 import 这个）
├── common.js  OpenIM 实体 → 页面结构（会话/消息/好友/群）
├── h5.js      @openim/client-sdk 实现（H5 构建引用）
└── app.js     @/uni_modules/unix-openim-sdk 实现（App 构建引用）
```

Contract：

```
connect() / getState() / on('state')
listConversations() / getConversation(id)
getMessages(id, { beforeClientMsgID, limit }) -> { list, hasMore }
sendTextMessage(id, text, { onPending }) -> Message   // onPending 用于先上屏 + 落 outbox
markConversationRead(id) / totalUnread()
listFriends() / listGroups()
getOrCreateConversation({ sourceID, sessionType })   // 通讯录点人/点群用
getFriendApplications(type) / handleFriendApplication()
addFriend() / deleteFriend() / updateFriendRemark() / getUsersInfo()
getGroupApplications(type) / handleGroupApplication()
getGroupInfo() / getGroupMembers() / createGroup() / joinGroup()
inviteGroupMembers() / kickGroupMember() / quitGroup() / dismissGroup()
transferGroupOwner() / setGroupInfo()
reconnect() / ensureConnection() / on('unread'|'application'|'auth')
```

### IM 业务矩阵（本轮已验证）

本地 OpenIM + 本地 OA，两个账号（102/103）双端 H5 实测：
好友搜索/申请/同意/拒绝、资料卡备注/删除、会话未读角标全局保留与清零、
单聊/群聊发送接收、分页加载更多、离线发送失败 outbox、重进恢复、重连后重发、
群创建/邀请/申请/同意/拒绝/改名/公告/踢人/转让/退出/解散、系统群通知、
聊天页标题进用户资料/群设置、连接中/未连接提示、H5 键盘 visualViewport 适配。

生产环境（`https://im.9ty.lol`）实测：登录、通讯录、搜索加好友、好友申请通过、
单聊发送、创建群、群设置页面均正常。所有接口仍走同源/代理，不新增后端改动。

H5 用 JS SDK 时有一个打包兼容：`@openim/client-sdk` 3.8.3 深层 import
`@openim/protocol/lib/pb/sdkws/sdkws` 没有对应 .js，已在 `vite.config.js` 里
用 `src/shims/openim-protocol-sdkws.js` 做别名转发。

页面上的约束：连接失败时聊天页显示「IM 未连接，点击重连」，消息列表顶部有连接横幅；
H5 在离线/半死 WS 后重连会整页刷新（保留当前路由、token、outbox），App 用原生 SDK
logout/login 重建长连接。

---

## 真机自测（不打包）

CLI 只能跑 H5；要在真机上看效果，用 HBuilderX 的「运行到手机」：

1. HBuilderX 打开 `uniapp/` 目录（不是 `dist/`）；
2. 手机开 USB 调试，连上后 HBuilderX「运行 → 运行到 Android App 基座」；
3. 手机和电脑同一局域网，把 `.env.dev.local` 里的 `VITE_PROXY_OA` 换成电脑内网 IP
   （如 `http://192.168.1.20:10010`）——**真机访问不到 127.0.0.1**；
4. 登录：IM 没起时用「本地联调进入」（`VITE_DEV_TOKEN`，7 天过期）；
5. 重点验：相机/定位权限弹窗、软键盘不遮输入框、返回键、弱网。

> 后端已经在 `0.0.0.0:10010` 监听，手机同网段可直接访问；Mongo 只绑了 127.0.0.1，不影响。

---

## 工程自检（`npm run guard`）

四个守卫串行，任一条不满足直接失败（`exit 1`）：

| 守卫 | 查什么 | 通过标志 |
|---|---|---|
| `guard:pages` | `pages.json` ↔ `src/pages` 双向一致、无重复、静态资源存在 | `OA_PAGES_OK pages=13` |
| `guard:reach` | 每个页面有入口（被其它文件跳转），不引用不存在的页面 | `OA_REACH_OK pages=13 refs=14` |
| `guard:contract` | `api/oa.js` 覆盖 PC 端 `oaApi.ts` 全部导出；不得自造接口路径 | `OA_CONTRACT_OK pc=50 uni=50 paths=40` |
| `guard:hygiene` | 禁 `height:100vh`（聊天页除外）、禁 `onPageScroll`、禁 `127.0.0.1`、禁 `console.log`、请求走统一门面、页面规模台账只许变小 | `OA_HYGIENE_OK files=39 backlog=2` |
| `guard:config` | `static/app-config.js` 字段完整、`index.html` 加载顺序正确 | `OA_CONFIG_OK ...` |

`npm run verify` = `guard` + `build:h5`。

## 运行环境（一次构建、多环境部署）

同一份 `dist` 换 `static/app-config.js` 即可指向不同环境，**不用重新打包**：

```js
window.__OA_CONFIG__ = {
  env: "prod",
  apiOrigin: "",        // 空=同源（nginx 反代）；填 https://域名=跨域直连
  imOrigin: "",         // IM 可单独域名；空时跟随 apiOrigin
  wsOrigin: "",         // 空时由 imOrigin 推导
  devToken: "",         // 生产必须留空
};
```

排查「这个包连的是哪套后端」：控制台 `window.__oaConfig__`，或看「我」页底部那行环境标签。

**APK 也支持运行时切换**：「我」页**长按版本号** → 填 `https://域名` → 保存并重启。
值存在本地存储（`oa_runtime_override`），只影响接口地址，不影响权限。一次打包可在多环境间切。

## 页面切换耗时（生产包实测）

| 动作 | 首开 | 再次 |
|---|---|---|
| 工作台 → 消息 | 154ms | 15–28ms |
| 消息 → 通讯录 | 230ms | 16–28ms |
| 通讯录 → 工作台 | 39ms | 19–32ms |
| 工作台 → 出勤 / 打卡 | 68–110ms | 40–68ms |

靠两件事做到的：`utils/swr.js` 的 SWR 缓存（先渲染缓存再刷新）与并行请求（不再串行等两个 RTT）。
复测：`node .local/tools/measure-nav.js http://127.0.0.1:5180`。

## 通用组件（先找再写）

| 组件 | 用途 |
|---|---|
| `app-icon` | 线性图标（内联 SVG，30 个语义图标，替代 emoji） |
| `page-header` | sticky 页头：返回 / 标题 / 右侧动作 slot |
| `bottom-sheet` | 底部弹层：遮罩 + 面板 + 标题 + 操作区 |
| `status-tag` | 状态标签，tone 语义色（pending/success/danger/info/muted/brand） |
| `form-field` | 表单项外壳：标签 + 必填徽标 + 提示 |
| `empty-state` | 空态 / 加载态（可带图标） |
| `page-shell` | 内页外壳（标题 + 返回） |
| `oim-avatar` / `app-tabbar` / `att-calendar` | 头像 / 底部导航 / 月历 |

**新页面不允许再复制 topbar / sheet / empty 的模板与样式**，一律用上表组件。

## 新业务模块骨架

`src/modules/_template/`（definition / api / pages）——复制即用，
规则写在 `definition.js`，页面只做装配。见该目录 `README.md`。

---

## 打包

| 命令 | 产物 | 状态 |
|---|---|---|
| `npm run build:h5` | `dist/build/h5` | ✅ 已验证（静态托管 + `/oa` 反代，真实后端可用） |
| `npm run build:app` | `dist/build/app`（App 资源包，HBuilderX 可导入） | ✅ 已验证（8 项安卓权限、minSdk 21 已合并进产物 manifest） |
| 云端打包（`cli pack`，见下） | Android APK（云端证书签名） | ✅ 已出包：`.local/apk/xinbo-oa-v3.apk`（`com.xinbo.oa`、20.4 MB、v1+v2 签名通过）；**未做真机安装验证** |

`appid` 已填 `__UNI__9F1C00E`（云打包用）。还差的是**自有签名证书**（正式包）和
一台跑得起 IM + OA 的服务器；测试包可以先用 DCloud 云端证书，接口地址在
「我」页长按版本号填（见 `src/utils/runtimeConfig.js`）。

### 出 APK（命令行云端打包）

```powershell
& "D:\HBuilderX\cli.exe" project open --path "<本仓库>\uniapp"    # 每台机器一次
& "D:\HBuilderX\cli.exe" pack --project "<本仓库>\uniapp" `
    --platform android --android.packagename com.xinbo.oa --android.androidpacktype 3
& "D:\HBuilderX\cli.exe" pack status --project "<本仓库>\uniapp"   # 排队第几位
```

`androidpacktype`：`3` 云端证书、`0` 自有证书、`1` 公共证书。第 2 步只打印临时下载地址
（限 5 次下载），要自己下载落地；排队时间随机（实测 22 分钟）。
同包名但签名不同的旧包必须先卸载，否则报 `INSTALL_FAILED_UPDATE_INCOMPATIBLE`。

### APK 的接口地址（已实测）

APK 里没有同源后端，所以要在 `.env.production` 填站点源：

```ini
VITE_APP_ORIGIN=https://im.example.com
```

`src/config/index.js` 会把 `/oa`、`/chat`、`/api` 自动拼成绝对地址，WebSocket 用 `wss://`，
**页面和请求层都不用改**。两种模式都验证过：

| 构建方式 | 产物里的地址 | 实测 |
|---|---|---|
| `VITE_APP_ORIGIN=`（空，默认） | 相对路径 `/oa/api/v1` | 同源静态托管 + 反代，工作台/出勤数据正常 |
| `VITE_APP_ORIGIN=http://127.0.0.1:5180` | 绝对地址 | 同一套页面从绝对地址取数，**0 JS 错误** |

App 端 IM 由官方 `unix-openim-sdk` UTS 插件提供（已放在
`src/uni_modules/unix-openim-sdk`），必须用自定义基座或正式包验证；标准基座只能看页面。
生产构建在 `.env.production` 设置 `VITE_APP_ORIGIN=https://im.9ty.lol`；
HBuilderX 云打包还要求 APPID 归属当前登录账号（或把账号加为项目成员）。

完整步骤、两条打包路线对比、验收清单见
[`docs/移动端-打包与推送预案.md`](../docs/移动端-打包与推送预案.md)。

---

## 验证方式

- **全量回归**：`.local/tools/regression-all.js` —— 13 个页面 × 3 个角色共 20 条断言
  （关键文案、页签数、权限可见性、消息气泡数），最近一次 20/20 通过。
- **按钮巡检**：`.local/tools/verify-buttons.js` —— 22 个按钮逐个点，断言有反馈/有跳转/有状态变化。
- **单页 E2E**：`.local/tools/verify-*.js`（打卡、出勤、日报、审批、查阅、请假、管理、IM）。
- **异常态 + 性能**：`.local/tools/verify-hardening.js` —— 401 / 断网 / 500 / 空数据四种异常，
  以及生产包在 6× CPU 降速下的滚动帧率、长任务、DOM 节点数。
- **生产构建**：`npm run build:h5` → `dist/build/h5`，用 `.local/tools/serve-dist.js`
  起静态服务 + `/oa` 反代，`verify-prod.js` 验证真实后端数据可用（无 JS 错误）。
- 截图统一落在 `.local/shots/`（回归的在 `regression/` 子目录）。

完整验收数据（含性能数字、权限矩阵、遗留项）见
[`docs/移动端-验收报告.md`](../docs/移动端-验收报告.md)；
逐页功能对照见 [`docs/移动端-页面迁移对照表.md`](../docs/移动端-页面迁移对照表.md)。
