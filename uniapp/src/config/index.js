/**
 * 全局运行配置。
 *
 * 读取顺序（后者覆盖前者）：
 *   1. 构建期 .env（VITE_OA_BASE 等，打包时写死）
 *   2. 运行时 /static/app-config.js 的 window.__OA_CONFIG__
 *
 * 为什么要运行时配置：**一次构建，多环境部署**。
 * 同一份 dist 放到 dev / staging / prod，只改 app-config.js 里的 apiOrigin，
 * 不用为每个环境各打一次包（也不会出现「测试包误连生产」）。
 *
 * 地址规则：
 *   - apiOrigin 留空 → 全部用同源相对路径（nginx 反代 /oa /chat /api）
 *   - apiOrigin 有值 → 拼成绝对地址（跨域部署 / APK 直连），WebSocket 自动转 ws(s)
 *
 * 环境变量来源见 vite.config.js 顶部注释；APK 仍用 VITE_APP_ORIGIN（构建期）。
 */

const env = import.meta.env;

import { getOverride } from "@/utils/runtimeConfig";

/** 运行时配置（H5 由 index.html 里的 /static/app-config.js 注入；App 端为空） */
const RUNTIME = (() => {
  try {
    if (typeof window !== "undefined" && window.__OA_CONFIG__) return window.__OA_CONFIG__;
    if (typeof globalThis !== "undefined" && globalThis.__OA_CONFIG__) return globalThis.__OA_CONFIG__;
  } catch (e) {
    /* 取不到就用构建期配置 */
  }
  return {};
})();

/** 构建期兜底：命令行 VITE_APP_ORIGIN 由 vite.config 注入成普通常量 */
const BUILD_ORIGIN = typeof __APP_ORIGIN__ !== "undefined" ? __APP_ORIGIN__ : "";

/**
 * App 端运行时覆盖：存在本地存储里的环境地址（我的 → 长按版本号可设）。
 * 优先级最高——用户显式选的环境应当盖过部署默认值。
 * 解析逻辑放在 utils/runtimeConfig.js，兼容 uni 包装与外部脚本写入的裸 JSON。
 */
const OVERRIDE = getOverride();

const trimSlash = (s) => String(s || "").replace(/\/$/, "");

/** 站点源：本地覆盖 > 运行时配置 > .env > 命令行 */
const ORIGIN = trimSlash(
  (OVERRIDE && OVERRIDE.apiOrigin) || RUNTIME.apiOrigin || env.VITE_APP_ORIGIN || BUILD_ORIGIN || ""
);
/**
 * IM（登录 / 聊天 / 通讯录）的站点源。
 *
 * 业务与登录是**两套服务**：OA 后端（apiOrigin）管考勤/日报/审批，
 * OpenIM（imOrigin）管登录、会话、消息。两者可以同域反代，也可以完全分开部署。
 * 没单独配 imOrigin 时回落到 apiOrigin —— 单域名反代的老部署不用改配置。
 */
const IM_ORIGIN = trimSlash(
  (OVERRIDE && OVERRIDE.imOrigin) || RUNTIME.imOrigin || ORIGIN
);
/** WebSocket 站点源：单独配了就用，否则从 IM_ORIGIN 推导 */
const WS_ORIGIN = trimSlash(
  (OVERRIDE && OVERRIDE.wsOrigin) || RUNTIME.wsOrigin || IM_ORIGIN.replace(/^http/, "ws")
);

const withOrigin = (path) => (ORIGIN && path.startsWith("/") ? `${ORIGIN}${path}` : path);
const withImOrigin = (path) => (IM_ORIGIN && path.startsWith("/") ? `${IM_ORIGIN}${path}` : path);

export const CONFIG = {
  // 应用
  appName: env.VITE_APP_NAME || "新博 OA",
  appVersion: env.VITE_APP_VERSION || "0.1.0",

  // 环境标识：页面/日志里可以直接显示，便于确认「这个包连的是哪套后端」
  envName: (OVERRIDE && OVERRIDE.env) || RUNTIME.env || env.MODE || "development",

  // 站点源（H5 留空=同源；跨域部署/APK 必填）
  origin: ORIGIN,
  /** IM 服务源（登录/会话/消息）；与业务后端可以不是同一个域名 */
  imOrigin: IM_ORIGIN,

  // 接口前缀（有 origin 时已拼成绝对地址）
  oaBase: withOrigin(env.VITE_OA_BASE || "/oa/api/v1"),
  chatBase: withImOrigin(env.VITE_CHAT_BASE || "/chat"),
  imApiBase: withImOrigin(env.VITE_API_BASE || "/api"),
  wsBase: env.VITE_WS_BASE || "/msg_gateway",
  /** IM SDK 初始化用的完整 WS 地址 */
  wsUrl: `${WS_ORIGIN}${env.VITE_WS_BASE || "/msg_gateway"}`,

  // IM 实现方式：mock（假数据）| api（后端站内通知）| sdk（OpenIM）
  // 本地覆盖优先：方便在「我」页一键切到真实接口，不用重新打包
  imMode: (OVERRIDE && OVERRIDE.imMode) || RUNTIME.imMode || env.VITE_IM_MODE || "mock",

  // 本地联调：填了 token 就能跳过 IM 登录直接进 OA 页面
  devToken: RUNTIME.devToken || env.VITE_DEV_TOKEN || "",
  devUserId: RUNTIME.devUserId || env.VITE_DEV_USER_ID || "",

  /** 原始运行时配置，排查问题时在控制台 `__oaConfig__` 可查 */
  runtime: RUNTIME,

  isDev: env.DEV,
};

/**
 * 登录后的默认首页。
 *
 * PC 端登录后进 /chat（消息）。移动端在 IM 还没接进来之前（mock 模式），
 * 消息页只有假数据，所以先落到工作台，保证一眼能看到真实业务数据。
 * 等 IM 接通把 imMode 切成 sdk，这里会自动变回消息页。
 */
export const HOME_PATH = CONFIG.imMode === "sdk" ? "/pages/message/index" : "/pages/work/index";

/** 本地联调入口是否可用 */
export const DEV_LOGIN_ENABLED = Boolean(CONFIG.devToken);

export default CONFIG;
