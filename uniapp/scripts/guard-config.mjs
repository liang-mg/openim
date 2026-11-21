#!/usr/bin/env node
/**
 * 守卫 4：运行时环境配置
 *
 * 「一次构建、多环境部署」依赖两件事，任何一件坏了都会静默退化：
 *   1. src/static/app-config.js 存在、能被解析、字段类型正确
 *   2. index.html 在 app 入口之前同步加载它（加载晚了读不到）
 *
 * 通过：OA_CONFIG_OK file=... env=...
 * 失败：OA_CONFIG_FAILED + 原因，exit 1
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const ROOT = path.resolve(import.meta.dirname, "..");
const CONFIG_FILE = path.join(ROOT, "src", "static", "app-config.js");
const INDEX_HTML = path.join(ROOT, "index.html");

const errors = [];

if (!fs.existsSync(CONFIG_FILE)) {
  errors.push("缺少 src/static/app-config.js（部署时改环境就靠它）");
}
if (!fs.existsSync(INDEX_HTML)) {
  errors.push("缺少 index.html");
}

let cfg = null;
if (fs.existsSync(CONFIG_FILE)) {
  const code = fs.readFileSync(CONFIG_FILE, "utf8");
  const sandbox = { window: {} };
  try {
    vm.runInNewContext(code, sandbox, { timeout: 1000 });
    cfg = sandbox.window.__OA_CONFIG__;
  } catch (e) {
    errors.push(`app-config.js 执行失败：${e.message}`);
  }
  if (!cfg || typeof cfg !== "object") {
    errors.push("app-config.js 没有设置 window.__OA_CONFIG__ 对象");
  } else {
    const spec = {
      env: "string",
      apiOrigin: "string",
      imOrigin: "string",
      wsOrigin: "string",
      imMode: "string",
      devToken: "string",
    };
    for (const [key, type] of Object.entries(spec)) {
      if (!(key in cfg)) errors.push(`app-config.js 缺少字段 ${key}`);
      else if (typeof cfg[key] !== type) errors.push(`app-config.js 字段 ${key} 应为 ${type}，实际 ${typeof cfg[key]}`);
    }
    if (cfg.imMode && !["mock", "api", "sdk"].includes(cfg.imMode)) {
      errors.push(`app-config.js 的 imMode 只能是 mock|api|sdk，实际 ${cfg.imMode}`);
    }
    for (const key of ["apiOrigin", "imOrigin", "wsOrigin"]) {
      if (cfg[key] && !/^(https?|wss?):\/\//.test(cfg[key])) {
        errors.push(`app-config.js 的 ${key} 必须是 http(s):// 或 ws(s):// 开头（或留空），实际 ${cfg[key]}`);
      }
    }
  }
}

if (fs.existsSync(INDEX_HTML)) {
  const html = fs.readFileSync(INDEX_HTML, "utf8");
  const cfgAt = html.indexOf("/static/app-config.js");
  const appAt = html.indexOf("/src/main.js");
  if (cfgAt < 0) errors.push("index.html 没有加载 /static/app-config.js，运行时配置不会生效");
  else if (appAt >= 0 && cfgAt > appAt) errors.push("index.html 里 app-config.js 必须排在 /src/main.js 之前");
}

if (errors.length) {
  process.stderr.write("OA_CONFIG_FAILED\n");
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(`OA_CONFIG_OK file=src/static/app-config.js env=${cfg.env} origin=${cfg.apiOrigin || "(同源)"}\n`);
