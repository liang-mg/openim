#!/usr/bin/env node
/**
 * 守卫 5：入口可达性（页面存在 ≠ 能点到）
 *
 * 只检查「注册」不够：一个页面注册了、文件也在，但如果没有任何地方跳转过去，
 * 用户永远到不了（只能手输 URL）。守卫用「有无引用」做近似判定。
 *
 * 判据：
 *   1. 每个注册页面（登录页与首页除外）必须被至少一个**其它**源文件引用
 *      （`/pages/<name>/index` 出现在 navigateTo / toUniPath / 列表配置里）
 *   2. 引用了不存在的页面路径 → 失败（防手滑写成 /pages/xxx/indx）
 *
 * 通过：OA_REACH_OK pages=<n> refs=<n>
 * 失败：OA_REACH_FAILED + 逐条，exit 1
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const errors = [];

/** 天然入口：登录页与首页由框架/HOME_PATH 直接打开，不需要被引用 */
const SEED = new Set(["pages/login/index", "pages/work/index"]);

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(vue|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const pagesJson = JSON.parse(fs.readFileSync(path.join(SRC, "pages.json"), "utf8"));
const pages = (pagesJson.pages || []).map((p) => p.path).filter(Boolean);

/** 去掉块注释与行注释，避免把文档里的示例路径当成真实引用 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const files = walk(SRC).filter((f) => !f.endsWith("pages.json"));
const contents = files.map((f) => ({
  file: f,
  rel: path.relative(SRC, f).replace(/\\/g, "/"),
  text: stripComments(fs.readFileSync(f, "utf8")),
}));

/** 模板目录引用的是占位页面，属设计如此，不参与「引用不存在」判定 */
const TEMPLATE_PREFIX = "modules/_template/";

// 收集所有形如 /pages/xxx/index 的引用
const refRe = /\/pages\/(?:[A-Za-z0-9_-]+\/)+index(?![A-Za-z0-9_/-])/g;
const referenced = new Map(); // page -> Set(rel)
for (const { rel, text } of contents) {
  for (const m of text.matchAll(refRe)) {
    const page = m[0].replace(/^\//, "");
    if (!referenced.has(page)) referenced.set(page, new Set());
    referenced.get(page).add(rel);
  }
}

// 1) 注册页面必须被「其它文件」引用（自身文件里的自引用不算）
for (const page of pages) {
  if (SEED.has(page)) continue;
  const refs = referenced.get(page) || new Set();
  const selfFile = `pages/${page}.vue`;
  const fromOthers = [...refs].filter((r) => r !== selfFile);
  if (fromOthers.length === 0) {
    errors.push(`页面没有入口，用户点不到：${page}（没有任何其它文件跳转到它）`);
  }
}

// 2) 引用了不存在的页面（模板目录除外）
const pageSet = new Set(pages);
for (const [page, refs] of referenced.entries()) {
  if (pageSet.has(page)) continue;
  const realRefs = [...refs].filter((r) => !r.startsWith(TEMPLATE_PREFIX));
  if (realRefs.length === 0) continue;
  errors.push(`引用了不存在的页面：/${page}（出现在 ${realRefs.slice(0, 3).join(", ")}）`);
}

if (errors.length) {
  process.stderr.write("OA_REACH_FAILED\n");
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(`OA_REACH_OK pages=${pages.length} refs=${referenced.size}\n`);
