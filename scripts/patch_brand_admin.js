#!/usr/bin/env node
/**
 * 管理后台（openim-admin-front，Umi 构建）品牌替换为「新博」。
 *
 * 该前端同样只有构建产物。文案大多在 umi.*.js 的 locale 里，且中文用
 * \uXXXX 转义存放（如 \u6B22\u8FCE\u4F7F\u7528OpenIM = 欢迎使用OpenIM），
 * 所以必须按转义后的原样替换，直接替换中文会匹配不到。
 *
 * 原始文件从镜像读取（容器内路径已被挂载覆盖），保证可重复执行。
 *
 * 用法：node scripts/patch_brand_admin.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'frontend-custom', 'admin');
const CONTAINER = 'openim-admin-front';
const HTML_DIR = '/usr/share/nginx/html';
const IMAGE = process.env.ADMIN_IMAGE ||
  execFileSync('docker', ['inspect', CONTAINER, '--format', '{{.Config.Image}}'], { encoding: 'utf8' }).trim();

// 新博 = \u65B0\u535A；欢迎来到新博 = \u6B22\u8FCE\u6765\u5230\u65B0\u535A
const WELCOME_ZH = '\\u6B22\\u8FCE\\u6765\\u5230\\u65B0\\u535A';

const RULES = [
  // 登录页欢迎语（中文原串 / 已替换过的中文 / 英文）
  ['\\u6B22\\u8FCE\\u4F7F\\u7528OpenIM', WELCOME_ZH],
  ['\\u6B22\\u8FCE\\u4F7F\\u7528\\u65B0\\u535A', WELCOME_ZH],
  // 兼容旧包：历史产物是「欢迎使用新搏」(\\u640F)，统一纠正为「新博」
  ['\\u6B22\\u8FCE\\u6765\\u5230\\u65B0\\u640F', WELCOME_ZH],
  ['\\u6B22\\u8FCE\\u4F7F\\u7528\\u65B0\\u640F', WELCOME_ZH],
  ['Welcome to OpenIM', 'Welcome to Xinbo'],
  // 版权 / 页脚
  ['OpenIM\\u540E\\u53F0\\u7BA1\\u7406\\u7CFB\\u7EDF', '\\u65B0\\u535A\\u540E\\u53F0\\u7BA1\\u7406\\u7CFB\\u7EDF'],
  // 站点标题（layout 配置 + 页面 title + 英文版权）
  ['title:"OpenIM-Admin"', 'title:"新博"'],
  ['<title>OpenIM-Admin</title>', '<title>新博</title>'],
  ['"app.copyright.produced":"OpenIM-Admin"', '"app.copyright.produced":"新博"'],
  // 兜底：任何位置的旧品牌「新搏」(\\u65B0\\u640F) 统一改为「新博」(\\u65B0\\u535A)
  // 覆盖登录页欢迎语、页脚版权等一切转义串；单个「搏」字不受影响。
  ['\\u65B0\\u640F', '\\u65B0\\u535A'],
];

const TARGETS = [
  'umi.8cd017f3.js',
  't__plugin-layout__Layout.a335d05b.async.js',
  'index.html',
];

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log(`镜像：${IMAGE}\n`);

let total = 0;
for (const rel of TARGETS) {
  const dst = path.join(OUT_DIR, path.basename(rel));
  const raw = execFileSync('docker', ['run', '--rm', '--entrypoint', 'cat', IMAGE, `${HTML_DIR}/${rel}`], {
    maxBuffer: 64 * 1024 * 1024,
  });
  let s = raw.toString('utf8');
  const hits = [];
  for (const [from, to] of RULES) {
    const n = s.split(from).length - 1;
    if (n > 0) {
      s = s.split(from).join(to);
      hits.push(`${from.slice(0, 26)} x${n}`);
      total += n;
    }
  }
  fs.writeFileSync(dst, s);

  // index.html 额外补 favicon / touch icon 指向「新博」图标
  if (rel === 'index.html' && !s.includes('/icons/icon-192x192.png')) {
    const patched = s.replace(
      '<link rel="stylesheet"',
      '<link rel="icon" type="image/png" href="/icons/icon-192x192.png" />\n' +
        '<link rel="apple-touch-icon" href="/icons/icon-192x192.png" />\n' +
        '<link rel="stylesheet"'
    );
    fs.writeFileSync(dst, patched);
  }

  console.log(`${path.basename(rel)}: ${hits.length ? hits.join(' | ') : '无命中'}`);
}

console.log(`\n共替换 ${total} 处 -> frontend-custom/admin/`);

// 左上角 logo 与 PWA 图标是 PNG 图片，字画在图里，无法用文案规则替换。
// 统一从 brand/（由 make_brand_icons.js 用「新博」源生成）拷贝，避免遗漏旧图「新搏」。
const BRAND_DIR = path.join(ROOT, 'frontend-custom', 'brand');
const ICON_MAP = [
  ['icon-512.png', ['icon.png', 'icon-512x512.png']],
  ['icon-192.png', ['icon-192x192.png']],
  ['icon-128.png', ['icon-128x128.png']],
];
console.log('\n同步品牌图标：');
for (const [src, dests] of ICON_MAP) {
  const srcPath = path.join(BRAND_DIR, src);
  if (!fs.existsSync(srcPath)) {
    console.log(`  跳过 ${src}（源不存在，请先运行 node scripts/make_brand_icons.js）`);
    continue;
  }
  for (const dest of dests) {
    fs.copyFileSync(srcPath, path.join(OUT_DIR, dest));
    console.log(`  ${src} -> ${dest}`);
  }
}
