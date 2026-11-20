# 前端改动清单（相对官方 openim-electron-demo）

> 基线 commit：`62d7ca7`（fix: resolve lint issues and stabilize Electron e2e）
> 用法：`frontend-patch/` 里的文件直接覆盖到官方 demo 同名路径。
> 「新增」= 官方没有，直接放进去；「修改」= 覆盖官方对应文件。

---

## 一、新增文件 / 目录（官方没有）

| 路径 | 说明 |
|---|---|
| `src/api/oaApi.ts` | OA 全部接口封装（打卡、出勤、团队、报表、请假、补卡、日报、文件、管理、工作台） |
| `src/pages/checkin/` | 拍照打卡页（真实 GPS + 服务端判位 + 照片水印上传） |
| `src/pages/attendance/` | 出勤记录页（我的/团队/报表/全公司四档 + 月历 + CSV 导出） |
| `src/pages/leave/` | 请假补卡页（我的申请/待我审批/已处理） |
| `src/pages/report/` | 工作报告页（日报化：提交、附件、2h 撤回、补写） |
| `src/pages/report-review/` | 领导查阅页（待查阅/已归档、两级点评） |
| `src/pages/oa-admin/` | 员工与权限管理页（管理员） |
| `src/pages/work/` | 工作台（真实待办/打卡卡） |
| `src/pages/mine/` | 我的（OA 入口） |
| `src/layout/MobileTabBar/` | 移动端底部导航 |
| `vite.web.config.ts` | Web 构建配置，同源代理 `/api`、`/oa`、`/chat`、`/msg_gateway` |

---

## 二、修改的官方文件（需覆盖）

| 路径 | 改动摘要 |
|---|---|
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

## 三、升级官方版本时的对账步骤

1. 官方 demo 拉新 commit 后，先看上述「修改」文件是否有冲突。
2. 重点检查 `src/routes/index.tsx`、`src/layout/LeftNavBar/index.tsx`、`src/App.tsx`——官方改这几个文件时我们的 OA 入口容易被冲掉。
3. `src/api/oaApi.ts` 依赖 `imApi.ts` 的 token/base 地址，官方若改鉴权方式需同步适配。
4. 对账后跑 `oa-custom/scripts/oa_*_check.js` 全套回归，确认无回退。
