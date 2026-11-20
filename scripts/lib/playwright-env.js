'use strict';
/**
 * 回归脚本公共环境（可移植）
 *
 * 统一解决三件原本写死在本机路径上的事：
 *   1. playwright-core 的 require 路径（pnpm 虚拟存储位置每台机器不同）
 *   2. 截图/附件输出目录
 *   3. Chrome 可执行文件路径
 *
 * 优先用环境变量覆盖，其次是常见位置自动探测，最后回退到 playwright 自带浏览器。
 * 这样同事 clone 仓库后只需在 frontend/ 下 pnpm i 即可跑全套 UI 回归。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');

// ---- playwright-core ----
function loadPlaywright() {
  const candidates = [];
  if (process.env.PLAYWRIGHT_CORE) candidates.push(process.env.PLAYWRIGHT_CORE);
  const nodeModulesDirs = [
    path.join(ROOT, 'node_modules'),
    path.join(ROOT, 'frontend', 'node_modules'),
    path.join(ROOT, '..', 'src', 'openim-electron-demo', 'node_modules'),
  ];
  for (const nm of nodeModulesDirs) {
    candidates.push(path.join(nm, 'playwright-core'));
    const pnpmDir = path.join(nm, '.pnpm');
    if (fs.existsSync(pnpmDir)) {
      for (const entry of fs.readdirSync(pnpmDir)) {
        if (entry.startsWith('playwright-core@')) {
          candidates.push(path.join(pnpmDir, entry, 'node_modules', 'playwright-core'));
        }
      }
    }
  }
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (_) {
      // 继续找下一个
    }
  }
  try {
    return require('playwright-core');
  } catch (_) {
    throw new Error(
      '找不到 playwright-core。请在 frontend/ 下执行 pnpm i，' +
        '或设置 PLAYWRIGHT_CORE=<playwright-core 目录的绝对路径>。\n已尝试: ' +
        candidates.join(', '),
    );
  }
}

const playwright = loadPlaywright();

// ---- 输出目录 ----
const OUTPUT_DIR = process.env.OA_OUTPUT_DIR
  ? path.resolve(process.env.OA_OUTPUT_DIR)
  : path.join(ROOT, 'output');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const OUT = OUTPUT_DIR.endsWith(path.sep) ? OUTPUT_DIR : OUTPUT_DIR + path.sep;

// ---- 浏览器路径 ----
const CHROME = (() => {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const candidates =
    process.platform === 'win32'
      ? [
          'C:/Program Files/Google/Chrome/Application/chrome.exe',
          'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
          path.join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
        ]
      : process.platform === 'darwin'
        ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
        : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return candidates.find((p) => p && fs.existsSync(p)) || '';
})();

// 启动参数：有 Chrome 就显式指定，没有就让 playwright 用自带 chromium。
const launchOptions = (extra = {}) =>
  CHROME ? { headless: true, executablePath: CHROME, ...extra } : { headless: true, ...extra };

module.exports = { ROOT, playwright, chromium: playwright.chromium, OUT, OUTPUT_DIR, CHROME, launchOptions };
