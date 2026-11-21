#!/usr/bin/env node
/**
 * 守卫 3：代码卫生与渲染禁令
 *
 * 规则来自 docs/移动端-渲染与性能约定.md，都是踩过坑才定的：
 *   1. 不许用 `height: 100vh` 做固定高度壳（聊天页例外）；`min-height: 100vh` 允许
 *   2. 不许用 `onPageScroll`（滚动高频事件，主线程被占满）
 *   3. 源码里不许出现 `127.0.0.1`（部署后会连到用户自己手机上）
 *   4. 不许留 `console.log`（console.warn/error 允许）
 *   5. 网络请求必须走统一门面 `utils/request.js`，页面不得直接 `uni.request`
 *   6. 页面文件规模：软阈值 600 非空行（提示）、硬上限 900（失败）；
 *      已超标的文件进 SPLIT_BACKLOG 台账 —— **台账只许变小**，改小后必须删条目
 *
 * 通过：OA_HYGIENE_OK files=<n> backlog=<n>
 * 失败：OA_HYGIENE_FAILED + 逐条（文件:行），exit 1
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const errors = [];
const warnings = [];

const PAGE_WARN_LINES = 600;
const PAGE_FAIL_LINES = 900;

/**
 * 子组件体积阈值：页面拆出来的部件应当「一眼看完」。
 * 组件写太大说明拆得不对（或者把逻辑又搬回组件里了）。
 */
const COMPONENT_WARN_LINES = 200;
const COMPONENT_FAIL_LINES = 300;

/**
 * 拆分欠债台账：值为「当前非空行数」。
 * 只许变小：实际行数 > 台账值 → 失败；实际行数 < 台账值 - 20 → 提示删条目。
 * 新增文件不得进台账。
 */
const SPLIT_BACKLOG = {};

/** 白名单：允许固定高度（聊天页输入框要钉在底部） */
const VH_ALLOW = new Set(["pages/chat/index.vue"]);
/** 白名单：允许直接调用 uni.request（统一门面 + 接口层 + IM 适配层） */
const REQUEST_ALLOW = ["utils/request.js", "api/"];

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(vue|js|ts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** 把块注释（/* *\/ 、<!-- -->）替换成等长空行，保留行号 */
function stripBlockComments(text) {
  const lines = text.split("\n");
  let inBlock = false;
  return lines.map((line) => {
    let out = "";
    let i = 0;
    while (i < line.length) {
      if (inBlock) {
        const end = line.indexOf("*/", i);
        if (end < 0) {
          i = line.length;
          break;
        }
        inBlock = false;
        i = end + 2;
        continue;
      }
      const start = line.indexOf("/*", i);
      const htmlStart = line.indexOf("<!--", i);
      const first = start < 0 ? htmlStart : htmlStart < 0 ? start : Math.min(start, htmlStart);
      if (first < 0) {
        out += line.slice(i);
        break;
      }
      out += line.slice(i, first);
      if (first === htmlStart) {
        const end = line.indexOf("-->", first + 4);
        if (end < 0) {
          inBlock = true;
          i = line.length;
        } else i = end + 3;
      } else {
        const end = line.indexOf("*/", first + 2);
        if (end < 0) {
          inBlock = true;
          i = line.length;
        } else i = end + 2;
      }
    }
    return out;
  });
}

const files = walk(SRC);
const rel = (f) => path.relative(SRC, f).replace(/\\/g, "/");

for (const file of files) {
  const r = rel(file);
  const rawLines = fs.readFileSync(file, "utf8").split("\n");
  const codeLines = stripBlockComments(rawLines.join("\n"));

  codeLines.forEach((line, i) => {
    const at = `${r}:${i + 1}`;
    const code = line.replace(/\/\/.*$/, "");
    if (!code.trim()) return;

    if (/(?<!min-)height\s*:\s*100vh/.test(code) && !VH_ALLOW.has(r)) {
      errors.push(`${at} 使用了 height:100vh（真机会溢出，改用整页滚动 + sticky/fixed；min-height 不受限）`);
    }
    if (/\bonPageScroll\b/.test(code)) {
      errors.push(`${at} 使用了 onPageScroll（改用 sticky / 减少滚动监听）`);
    }
    if (/127\.0\.0\.1|localhost:(10010|10002|10008)/.test(code)) {
      errors.push(`${at} 写死了本机地址（部署后会连到用户自己的设备）`);
    }
    if (/\bconsole\.log\s*\(/.test(code)) {
      errors.push(`${at} 残留 console.log（调试代码不要进仓库）`);
    }
    if (/\buni\.request\s*\(/.test(code) && !REQUEST_ALLOW.some((p) => r === p || r.startsWith(p))) {
      errors.push(`${at} 绕过统一请求门面直接调 uni.request（请用 utils/request.js）`);
    }
    // 图标必须是 app-icon：emoji 在真机上各家字形不一样，质感和 PC 端对不齐
    if (/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u.test(code)) {
      errors.push(`${at} 用了 emoji/字符图标（改用 <app-icon name="...">，图标表在 components/app-icon.vue）`);
    }
  });

  if (r.startsWith("pages/") && r.endsWith(".vue")) {
    const nonEmpty = rawLines.filter((l) => l.trim()).length;
    // 页面内拆出来的子组件：单独按更严的阈值卡（pages/xxx/components/*.vue）
    const isSubComponent = r.split("/")[2] === "components";
    if (isSubComponent) {
      if (nonEmpty > COMPONENT_FAIL_LINES) {
        errors.push(`${r} 子组件非空行 ${nonEmpty} 超过 ${COMPONENT_FAIL_LINES}，请继续拆分或把逻辑上移到页面`);
      } else if (nonEmpty > COMPONENT_WARN_LINES) {
        warnings.push(`${r} 子组件非空行 ${nonEmpty}（建议 ≤${COMPONENT_WARN_LINES}）`);
      }
      continue;
    }
    const baseline = SPLIT_BACKLOG[r];
    if (baseline) {
      if (nonEmpty > baseline) {
        errors.push(`${r} 非空行 ${nonEmpty} 超过台账基线 ${baseline}（台账只许变小，请先拆分再改）`);
      } else if (nonEmpty < baseline - 20) {
        warnings.push(`${r} 已降到 ${nonEmpty} 行（台账 ${baseline}），请从 SPLIT_BACKLOG 删除该条目`);
      }
    } else if (nonEmpty > PAGE_FAIL_LINES) {
      errors.push(`${r} 非空行 ${nonEmpty} 超过硬上限 ${PAGE_FAIL_LINES}，请拆分（不得新增台账条目）`);
    } else if (nonEmpty > PAGE_WARN_LINES) {
      warnings.push(`${r} 非空行 ${nonEmpty}（软阈值 ${PAGE_WARN_LINES}，考虑拆分）`);
    }
  }
}

for (const w of warnings) process.stdout.write(`  warn  ${w}\n`);

if (errors.length) {
  process.stderr.write("OA_HYGIENE_FAILED\n");
  for (const e of errors.slice(0, 40)) process.stderr.write(`  - ${e}\n`);
  if (errors.length > 40) process.stderr.write(`  ... 其余 ${errors.length - 40} 条省略\n`);
  process.exit(1);
}

process.stdout.write(`OA_HYGIENE_OK files=${files.length} backlog=${Object.keys(SPLIT_BACKLOG).length}\n`);
