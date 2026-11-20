#!/usr/bin/env node
/**
 * 桌面端服务器地址派生规则回归
 *
 * 验证 src/utils/serverConfig.ts 的地址派生逻辑：
 * - 标准端口模式（填域名/IP）
 * - 反向代理模式（填 https:// 域名）
 * - 输入归一化（协议头、末尾斜杠、显式端口）
 * - 源码一致性：关键常量和分支必须存在于 serverConfig.ts，防止改了测试没改源码
 *
 * 用法：node scripts/oa_desktop_config_check.js
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(
  ROOT,
  "src/openim-electron-demo/src/utils/serverConfig.ts",
);

let pass = 0;
let fail = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}`);
    console.log(`      期望: ${JSON.stringify(expected)}`);
    console.log(`      实际: ${JSON.stringify(actual)}`);
  }
}

// ---- 与源码保持一致的派生实现（镜像 serverConfig.ts） ----
const PORTS = { api: 10002, ws: 10001, chat: 10008, oa: 10010, oss: 10005, livekit: 7880 };
const PROXY_PATHS = { api: "/api", ws: "/msg_gateway", chat: "/chat", oa: "/oa", oss: "/oss", livekit: "/livekit" };

function normalizeHost(raw) {
  let value = (raw ?? "").trim();
  while (value.endsWith("/")) value = value.slice(0, -1);
  return value;
}
function parseHost(raw) {
  const value = normalizeHost(raw);
  if (!value) return null;
  if (value.startsWith("https://")) return { proxy: true, host: value.slice(8), scheme: "https" };
  if (value.startsWith("http://")) return { proxy: false, host: value.slice(7), scheme: "http" };
  return { proxy: false, host: value, scheme: "http" };
}
function withPort(host, defaultPort, scheme) {
  const explicitPort = host.startsWith("[")
    ? /^\[[^\]]+\]:(\d+)$/.exec(host)
    : /:[0-9]+$/.exec(host);
  if (explicitPort || (scheme === "http" && defaultPort === 80) || (scheme === "https" && defaultPort === 443)) {
    return `${scheme}://${host}`;
  }
  return `${scheme}://${host}:${defaultPort}`;
}
function resolve(host) {
  const p = parseHost(host);
  if (!p) return null;
  const { proxy, host: h, scheme } = p;
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
  const http = (port) => withPort(h, port, "http");
  const ws = (port) => `ws://${h}:${port}`;
  return {
    api: http(PORTS.api), ws: ws(PORTS.ws), chat: http(PORTS.chat),
    oaApi: `${http(PORTS.oa)}/oa/api/v1`, oss: http(PORTS.oss), livekit: ws(PORTS.livekit),
  };
}

console.log("\n=== 1. 输入归一化 ===");
check("去首尾空格", normalizeHost("  oa.company.com  "), "oa.company.com");
check("去末尾斜杠", normalizeHost("oa.company.com///"), "oa.company.com");
check("空输入", normalizeHost("   "), "");

console.log("\n=== 2. 标准端口模式 ===");
const std = resolve("oa.company.com");
check("域名 - IM API", std.api, "http://oa.company.com:10002");
check("域名 - 消息 WS", std.ws, "ws://oa.company.com:10001");
check("域名 - Chat", std.chat, "http://oa.company.com:10008");
check("域名 - OA API（直连必须带 /oa 前缀，与后端 r.Group(\"/oa/api/v1\") 一致）", std.oaApi, "http://oa.company.com:10010/oa/api/v1");
check("域名 - 文件", std.oss, "http://oa.company.com:10005");
check("域名 - 音视频", std.livekit, "ws://oa.company.com:7880");

console.log("\n=== 3. 协议头与端口 ===");
check("http:// 前缀被剥掉", resolve("http://10.0.0.5").api, "http://10.0.0.5:10002");
check("显式端口覆盖默认", resolve("10.0.0.5:8080").api, "http://10.0.0.5:8080");
check("带协议和端口", resolve("http://10.0.0.5:9090").chat, "http://10.0.0.5:9090");

console.log("\n=== 4. 反向代理模式 ===");
const proxy = resolve("https://oa.company.com");
check("反代 - IM API", proxy.api, "https://oa.company.com/api");
check("反代 - 消息 WS", proxy.ws, "wss://oa.company.com/msg_gateway");
check("反代 - OA API", proxy.oaApi, "https://oa.company.com/oa/api/v1");
check("反代 - 音视频", proxy.livekit, "wss://oa.company.com/livekit");
check("反代末尾斜杠", resolve("https://oa.company.com/").api, "https://oa.company.com/api");

console.log("\n=== 5. 空输入 ===");
check("空 host 返回 null", resolve(""), null);

console.log("\n=== 6. 源码一致性（防止改了测试没改源码） ===");
const source = fs.existsSync(SOURCE) ? fs.readFileSync(SOURCE, "utf8") : "";
check("源码存在", source.length > 0, true);
for (const [name, token] of [
  ["HOST_KEY", 'const HOST_KEY = "OA_SERVER_HOST"'],
  ["端口 10002", "api: 10002"],
  ["端口 7880", "livekit: 7880"],
  ["反代路径 /msg_gateway", 'ws: "/msg_gateway"'],
  ["反代判定", 'value.startsWith("https://")'],
  ["运行时判定函数", "export const isElectronRuntime"],
  ["派生函数", "export const resolveServerURLs"],
  ["切服务器清 token", "clearIMProfile()"],
  ["内置服务器地址常量", "export const BUILTIN_SERVER_HOST"],
  ["直连 OA 带 /oa 前缀", "oaApi: `${http(PORTS.oa)}/oa/api/v1`"],
  ["桌面模式用内置地址", "parseHost(host ?? BUILTIN_SERVER_HOST)"],
]) {
  check(`源码含 ${name}`, source.includes(token), true);
}

console.log("\n=== 7. 登录页不再让用户输入服务器地址 ===");
const LOGIN_FORM = path.join(
  path.dirname(path.dirname(SOURCE)),
  "pages/login/LoginForm.tsx",
);
const loginSource = fs.existsSync(LOGIN_FORM) ? fs.readFileSync(LOGIN_FORM, "utf8") : "";
check("登录表单源码存在", loginSource.length > 0, true);
check("无服务器地址表单项", !loginSource.includes('name="serverHost"'), true);
check("无 needServerHost 分支", !loginSource.includes("needServerHost"), true);

console.log(`\n=== 结果：${pass} 通过 / ${fail} 失败 ===\n`);
process.exit(fail ? 1 : 0);
