#!/usr/bin/env node
/**
 * 前端源码双向同步（本机大仓 <-> 协作仓）
 *
 * 背景：本机在 openim-docker/src/openim-electron-demo 开发并打包，
 * 协作仓里是同一份源码的干净快照 frontend/。两者不是同一个 git 仓库，
 * 需要显式同步，否则同事拿到的和你打包的不是同一份代码。
 *
 * 只同步源码/配置，不删除目标里多出来的文件（产物、密钥保持原样）。
 *
 * 用法（在 oa-custom 目录下）：
 *   node scripts/sync-frontend.mjs status              # 只看差异
 *   node scripts/sync-frontend.mjs to-repo             # 本机改动 -> 仓库（提交前）
 *   node scripts/sync-frontend.mjs to-local            # 仓库改动 -> 本机（pull 后）
 *   node scripts/sync-frontend.mjs to-repo --dry-run   # 预演，不写文件
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const REPO_FRONTEND = path.join(REPO, "frontend");
const LOCAL_APP = path.join(REPO, "..", "src", "openim-electron-demo");

// 这些目录/文件按约定不入库，也不参与同步
const EXCLUDE_DIRS = new Set([
  "node_modules",
  "dist",
  "dist-electron",
  "release",
  ".git",
  "output",
  "playwright-report",
  "test-results",
]);
const EXCLUDE_FILES = new Set([".env", ".env.local", ".env.local.local-backup", ".DS_Store"]);

function shouldSkip(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return true;
  const name = parts[parts.length - 1];
  return EXCLUDE_FILES.has(name) || name.startsWith(".env.local");
}

function collect(root, base = "", out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (shouldSkip(rel)) continue;
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) collect(abs, rel, out);
    else if (entry.isFile()) out.push({ rel, abs });
  }
  return out;
}

const direction = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (!["status", "to-repo", "to-local"].includes(direction)) {
  console.error("用法: node scripts/sync-frontend.mjs <status|to-repo|to-local> [--dry-run]");
  process.exit(1);
}
if (!fs.existsSync(REPO_FRONTEND) || !fs.existsSync(LOCAL_APP)) {
  console.error(`目录不存在:\n  ${REPO_FRONTEND}\n  ${LOCAL_APP}`);
  process.exit(1);
}

const pairs = direction === "to-repo" ? [LOCAL_APP, REPO_FRONTEND] : [REPO_FRONTEND, LOCAL_APP];
const [from, to] = pairs;
const files = collect(from);

const diffs = [];
for (const { rel, abs } of files) {
  const dest = path.join(to, rel);
  const srcBuf = fs.readFileSync(abs);
  const destBuf = fs.existsSync(dest) ? fs.readFileSync(dest) : null;
  if (!destBuf || !srcBuf.equals(destBuf)) diffs.push(rel);
}

if (direction === "status") {
  console.log(`${from}\n  -> ${to}`);
  console.log(`共 ${files.length} 个源码文件，其中 ${diffs.length} 个不同：`);
  diffs.forEach((d) => console.log(`  DIFF ${d}`));
  process.exit(diffs.length ? 1 : 0);
}

for (const rel of diffs) {
  const abs = path.join(from, rel);
  const dest = path.join(to, rel);
  if (!dryRun) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(abs, dest);
  }
  console.log(`${dryRun ? "WOULD " : ""}COPY ${rel}`);
}
console.log(`\n${dryRun ? "预演" : "完成"}：${diffs.length} 个文件${direction === "to-repo" ? "已同步到仓库 frontend/，记得 git add/commit" : "已同步到本机"}`);
