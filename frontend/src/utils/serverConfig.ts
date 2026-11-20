/**
 * 服务器地址运行时配置
 *
 * Web 浏览器：走同源相对路径，由 vite dev / nginx 反代，行为与改造前完全一致。
 * Electron 桌面端：登录页填一个 host，这里派生出全部 6 个服务的完整地址。
 *
 * 地址派生是本系统唯一实现，所有调用点（登录、IM SDK、OA、文件、音视频）
 * 都必须引用本文件，禁止在别处硬编码端口或拼接地址。
 */

const HOST_KEY = "OA_SERVER_HOST";

/**
 * 桌面端内置的后端服务器地址（打包时写死，登录页不再让用户输入）。
 *
 * 换服务器时：改这一行 → 重新打包安装。
 * - 只填域名或 IP（不带 http://）：程序按标准端口派生 6 个服务地址；
 * - 填 https://域名：按反向代理模式派生（api/chat/oa/oss/livekit 走路径前缀）。
 */
export const BUILTIN_SERVER_HOST = "127.0.0.1";

/** 标准端口模式下的服务端口（与 oa-custom/base/docker-compose.yaml 一致） */
const PORTS = {
  api: 10002,
  ws: 10001,
  chat: 10008,
  oa: 10010,
  oss: 10005,
  livekit: 7880,
} as const;

/** 反向代理模式下的路径前缀（与 nginx/site.conf 一致） */
const PROXY_PATHS = {
  api: "/api",
  ws: "/msg_gateway",
  chat: "/chat",
  // 注意：OA 业务接口的 baseURL 是 /oa/api/v1，这里只给前缀
  oa: "/oa",
  oss: "/oss",
  livekit: "/livekit",
} as const;

export interface ServerURLs {
  api: string;
  ws: string;
  chat: string;
  oaApi: string;
  oss: string;
  livekit: string;
}

/**
 * 判定是否处于需要运行时配置的 Electron 生产环境。
 * - Web 浏览器：window.electronAPI 不存在 → false
 * - Electron dev：VITE_DEV_SERVER_URL 存在，vite 有代理 → false
 * - Electron 生产：loadFile，origin 是 file:// → true
 */
export const isElectronRuntime = (): boolean => {
  if (typeof window === "undefined") return false;
  if (!window.electronAPI) return false;
  if (import.meta.env.VITE_DEV_SERVER_URL) return false;
  return true;
};

/** 读取用户填写的原始 host（未做归一化） */
export const getServerHost = (): string => {
  if (typeof localStorage === "undefined") return "";
  return localStorage.getItem(HOST_KEY) ?? "";
};

/**
 * 保存 host。若与旧值不同，清空登录态，避免拿 A 服务器的 token 访问 B 服务器。
 * 这是"未配置 → 已配置 / 切换服务器"的唯一状态转换点。
 */
export const setServerHost = (host: string): void => {
  const normalized = normalizeHost(host);
  const previous = getServerHost();
  if (previous && previous !== normalized) {
    // 切换服务器必须重新登录；动态 import 避免循环依赖
    void import("./storage").then((m) => m.clearIMProfile());
  }
  localStorage.setItem(HOST_KEY, normalized);
};

/**
 * 归一化输入：去首尾空格、去末尾斜杠。
 * 保留协议头（https:// 用于判定反代模式，http:// 会被剥掉）。
 */
export const normalizeHost = (raw: string): string => {
  let value = (raw ?? "").trim();
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
};

interface ParsedHost {
  /** 是否 https 反向代理模式 */
  proxy: boolean;
  /** 归一化后的 host（不含协议头，可能含端口） */
  host: string;
  /** 协议：标准模式固定 http/ws，反代模式跟随用户输入的 https */
  scheme: "http" | "https";
}

const parseHost = (raw: string): ParsedHost | null => {
  const value = normalizeHost(raw);
  if (!value) return null;

  if (value.startsWith("https://")) {
    return { proxy: true, host: value.slice("https://".length), scheme: "https" };
  }
  if (value.startsWith("http://")) {
    return { proxy: false, host: value.slice("http://".length), scheme: "http" };
  }
  return { proxy: false, host: value, scheme: "http" };
};

/** 若 host 显式带端口则用它覆盖默认端口；否则拼默认端口 */
const withPort = (host: string, defaultPort: number, scheme: "http" | "https"): string => {
  // IPv6 用 [] 包裹，端口在 ] 之后
  const explicitPort = host.startsWith("[")
    ? /^\[[^\]]+\]:(\d+)$/.exec(host)
    : /:[0-9]+$/.exec(host);
  const hasPort = !!explicitPort;
  const isDefaultPort =
    (scheme === "http" && defaultPort === 80) ||
    (scheme === "https" && defaultPort === 443);
  if (hasPort || isDefaultPort) return `${scheme}://${host}`;
  return `${scheme}://${host}:${defaultPort}`;
};

const wsSchemeOf = (scheme: "http" | "https"): "ws" | "wss" =>
  scheme === "https" ? "wss" : "ws";

/**
 * 派生 6 个服务的完整地址。纯函数，不依赖浏览器环境（可在 Node 单测）。
 *
 * @param host 用户填写的 host；不传时读 localStorage。
 * @param forceBrowser 强制按 Web 同源模式返回（用于 Web 端和测试）。
 */
export const resolveServerURLs = (host?: string, forceBrowser = false): ServerURLs => {
  const browserMode = forceBrowser || !isElectronRuntime();
  if (browserMode) {
    const origin = typeof window !== "undefined" ? window.location.origin : "http://localhost";
    const wsScheme =
      typeof window !== "undefined" && window.location.protocol === "https:"
        ? "wss"
        : "ws";
    return {
      api: `${origin}/api`,
      ws: `${wsScheme}://${typeof window !== "undefined" ? window.location.host : "localhost"}/msg_gateway`,
      chat: `${origin}/chat`,
      oaApi: `${origin}/oa/api/v1`,
      oss: `${origin}/oss`,
      livekit: `${wsScheme}://${typeof window !== "undefined" ? window.location.host : "localhost"}/livekit`,
    };
  }

  // 桌面端生产模式：地址在打包时内置（BUILTIN_SERVER_HOST），登录页不再输入。
  // 保留 host 入参仅用于回归测试注入；正常运行时一律用内置地址。
  const parsed = parseHost(host ?? BUILTIN_SERVER_HOST);
  if (!parsed) {
    // 内置地址为空（部署方误删）：回退同源，避免白屏；此时登录接口会失败但页面可用。
    const origin = window.location.origin;
    const wsScheme = window.location.protocol === "https:" ? "wss" : "ws";
    return {
      api: `${origin}/api`,
      ws: `${wsScheme}://${window.location.host}/msg_gateway`,
      chat: `${origin}/chat`,
      oaApi: `${origin}/oa/api/v1`,
      oss: `${origin}/oss`,
      livekit: `${wsScheme}://${window.location.host}/livekit`,
    };
  }

  const { proxy, host: h, scheme } = parsed;
  if (proxy) {
    const base = `https://${h}`;
    return {
      api: `${base}${PROXY_PATHS.api}`,
      ws: `wss://${h}${PROXY_PATHS.ws}`,
      chat: `${base}${PROXY_PATHS.chat}`,
      oaApi: `${base}${PROXY_PATHS.oa}/api/v1`,
      oss: `${base}${PROXY_PATHS.oss}`,
      livekit: `wss://${h}${PROXY_PATHS.livekit}`,
    };
  }

  const http = (port: number) => withPort(h, port, "http");
  const ws = (port: number) => `${wsSchemeOf("http")}://${h}:${port}`;
  return {
    api: http(PORTS.api),
    ws: ws(PORTS.ws),
    chat: http(PORTS.chat),
    // 后端 OA 路由注册在 /oa/api/v1（见 router.go 的 r.Group("/oa/api/v1")），
    // Web 端靠 vite 代理的 /oa 前缀补齐，桌面端直连 10010 必须自己带上 /oa，
    // 否则全部 OA 接口 404（/me 返回 404 → 身份判不出来 → 报告查阅看成无权）。
    oaApi: `${http(PORTS.oa)}/oa/api/v1`,
    oss: http(PORTS.oss),
    livekit: ws(PORTS.livekit),
  };
};

/** 供回归脚本在 Node 侧直接测试派生规则：注入一个假的 window.electronAPI */
export const __testing = { PORTS, PROXY_PATHS, parseHost, withPort };
