#!/usr/bin/env node
/**
 * 守卫 1：页面注册一致性
 *
 * 判据（任一不满足即失败）：
 *   1. pages.json 里每条 path 都能在 src/ 找到对应 .vue
 *   2. src/pages 下每个 index.vue 都在 pages.json 注册（避免写了页面进不去）
 *   3. 没有重复注册
 *   4. pages.json 引用的静态资源（tabbar 图标等）真实存在
 *
 * 通过：OA_PAGES_OK pages=<n>
 * 失败：OA_PAGES_FAILED + 逐条原因，exit 1
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const errors = [];
const warnings = [];

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    errors.push(`${path.relative(ROOT, file)} 解析失败：${e.message}`);
    return null;
  }
}

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

const pagesJson = readJson(path.join(SRC, "pages.json"));
if (pagesJson) {
  const registered = new Set();
  for (const page of pagesJson.pages || []) {
    const p = page.path;
    if (!p) {
      errors.push("pages.json 存在空 path 条目");
      continue;
    }
    if (registered.has(p)) errors.push(`重复注册页面：${p}`);
    registered.add(p);

    const vue = path.join(SRC, `${p}.vue`);
    if (!fs.existsSync(vue)) errors.push(`注册了但找不到文件：src/${p}.vue`);
  }

  // 反向：src/pages 下每个 index.vue 都要注册（组件目录不在 pages 下）
  const pageFiles = walk(path.join(SRC, "pages")).filter((f) => f.endsWith(".vue"));
  for (const file of pageFiles) {
    const rel = path.relative(SRC, file).replace(/\\/g, "/").replace(/\.vue$/, "");
    if (!registered.has(rel)) {
      // 一个页面目录下可能有组件（非 index.vue），只对 index.vue 强制注册
      if (rel.endsWith("/index")) errors.push(`页面未注册：src/${rel}.vue`);
      else warnings.push(`非入口页面文件（未注册，通常是组件）：src/${rel}.vue`);
    }
  }

  // 静态资源引用检查（tabbar 图标等）
  const texts = JSON.stringify(pagesJson);
  for (const m of texts.matchAll(/"(\/static\/[^"]+)"/g)) {
    const asset = path.join(SRC, m[1].replace(/^\//, ""));
    if (!fs.existsSync(asset)) errors.push(`pages.json 引用的静态资源不存在：${m[1]}`);
  }

  process.stdout.write(`pages.json 注册 ${registered.size} 条，页面文件 ${pageFiles.length} 个\n`);
}

for (const w of warnings) process.stdout.write(`  warn  ${w}\n`);

if (errors.length) {
  process.stderr.write("OA_PAGES_FAILED\n");
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.exit(1);
}

process.stdout.write(`OA_PAGES_OK pages=${(pagesJson?.pages || []).length}\n`);
