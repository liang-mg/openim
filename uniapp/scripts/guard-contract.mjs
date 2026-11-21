#!/usr/bin/env node
/**
 * 守卫 2：接口契约与 PC 端对齐
 *
 * 为什么要有这条：三端一致性靠「同一份接口契约」，不靠人眼。
 * 本项目的做法是 `uniapp/src/api/oa.js` 与 `frontend/src/api/oaApi.ts` 同名同参，
 * 这条守卫把「同名」变成可执行断言。
 *
 * 判据：
 *   1. PC 端导出的每个接口函数，uniapp 侧必须有同名实现（缺失 = 失败）
 *   2. uniapp 侧的接口路径必须能在 PC 端找到（防止手写路径写错）
 *   3. uniapp 多出来的函数 = 警告（可能是合理的本地工具函数，但要在 PR 里说明）
 *
 * 通过：OA_CONTRACT_OK pc=<n> uni=<n> paths=<n>
 * 失败：OA_CONTRACT_FAILED + 逐条缺失，exit 1
 */
import fs from "node:fs";
import path from "node:path";

const UNIAPP_ROOT = path.resolve(import.meta.dirname, "..");
const REPO_ROOT = path.resolve(UNIAPP_ROOT, "..");
const PC_API = path.join(REPO_ROOT, "frontend", "src", "api", "oaApi.ts");
const UNI_API = path.join(UNIAPP_ROOT, "src", "api", "oa.js");

const errors = [];
const warnings = [];

function read(file, label) {
  if (!fs.existsSync(file)) {
    errors.push(`${label} 不存在：${file}`);
    return "";
  }
  return fs.readFileSync(file, "utf8");
}

const pcSrc = read(PC_API, "PC 接口文件");
const uniSrc = read(UNI_API, "uniapp 接口文件");

/** 提取 `export async function foo` / `export function foo` / `export const foo =` / `export { foo } from` */
function exportNames(src) {
  const names = new Set();
  for (const m of src.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)/g)) names.add(m[1]);
  for (const m of src.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*(?::[^=]+)?=/g)) names.add(m[1]);
  // 再导出：export { a, b as c } from "..."
  for (const m of src.matchAll(/export\s*\{([^}]+)\}\s*from/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop();
      if (name && /^[A-Za-z0-9_]+$/.test(name)) names.add(name);
    }
  }
  return names;
}

/** 提取接口路径字面量：以 / 开头、出现在 get/post 调用里的字符串 */
function endpointPaths(src) {
  const out = new Set();
  for (const m of src.matchAll(/\b(?:get|post|put|del|request)\s*(?:<[^>]*>)?\(\s*[`"'](\/[^`"']*)[`"']/g)) {
    out.add(m[1]);
  }
  // 兼容 `get("/x")` 里带模板变量的写法：/checkin/team/${userId} -> /checkin/team/
  return new Set([...out].map((p) => p.replace(/\$\{[^}]*\}/g, "")));
}

const pcNames = exportNames(pcSrc);
const uniNames = exportNames(uniSrc);

const missing = [...pcNames].filter((n) => !uniNames.has(n)).sort();
const extra = [...uniNames].filter((n) => !pcNames.has(n)).sort();

if (missing.length) {
  for (const n of missing) errors.push(`uniapp 缺少接口实现：${n}（PC 端 oaApi.ts 有）`);
}
if (extra.length) {
  for (const n of extra) warnings.push(`uniapp 多出函数：${n}（PC 端没有，若为本地工具函数请在注释里说明）`);
}

// ---- 路径核对 ----
const pcPaths = endpointPaths(pcSrc);
const uniPaths = endpointPaths(uniSrc);
let checked = 0;
for (const p of uniPaths) {
  if (!p || p === "/") continue;
  checked += 1;
  // PC 端允许前缀匹配（uniapp 可能把 /checkin/team/${id} 归一成 /checkin/team/）
  const hit = [...pcPaths].some((pc) => pc === p || pc.startsWith(p) || p.startsWith(pc));
  if (!hit) errors.push(`uniapp 使用了 PC 端不存在的接口路径：${p}`);
}

process.stdout.write(
  `PC 接口 ${pcNames.size} 个 / uniapp ${uniNames.size} 个 / 校验路径 ${checked} 条\n`
);
for (const w of warnings) process.stdout.write(`  warn  ${w}\n`);

if (errors.length) {
  process.stderr.write("OA_CONTRACT_FAILED\n");
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(`OA_CONTRACT_OK pc=${pcNames.size} uni=${uniNames.size} paths=${checked}\n`);
