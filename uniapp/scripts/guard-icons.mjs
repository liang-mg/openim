#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const ICON_ROOT = path.join(ROOT, "src", "static", "icons");
const COMPONENT = path.join(ROOT, "src", "components", "app-icon.vue");
const MANIFEST = path.join(ROOT, "src", "manifest.json");
const names = [
  "camera", "document", "clock", "calendar", "video", "check", "check-square",
  "user", "users", "settings", "logout", "shield", "bell", "chevron-right",
  "chevron-left", "plus", "search", "warning", "image", "download", "trash",
  "edit", "send", "close", "more", "message", "list", "chart", "refresh",
  "filter", "location", "paperclip",
];
const variants = ["brand", "white", "ink", "muted", "ok", "warn", "danger"];
const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const launchers = { hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const errors = [];

for (const variant of variants) {
  for (const name of names) {
    const file = path.join(ICON_ROOT, variant, `${name}.png`);
    if (!fs.existsSync(file)) {
      errors.push(`缺少图标：src/static/icons/${variant}/${name}.png`);
      continue;
    }
    const data = fs.readFileSync(file);
    if (data.length < 100 || !data.subarray(0, 8).equals(pngSignature)) {
      errors.push(`图标不是有效 PNG：src/static/icons/${variant}/${name}.png`);
    }
  }
}

for (const [density, expectedSize] of Object.entries(launchers)) {
  const relative = `static/brand/app-icons/${density}.png`;
  for (const prefix of ["src", ""]) {
    const file = path.join(ROOT, prefix, relative);
    const label = prefix ? `${prefix}/${relative}` : relative;
    if (!fs.existsSync(file)) {
      errors.push(`缺少 PC 同源桌面图标：${label}`);
      continue;
    }
    const data = fs.readFileSync(file);
    const width = data.length >= 24 ? data.readUInt32BE(16) : 0;
    const height = data.length >= 24 ? data.readUInt32BE(20) : 0;
    if (!data.subarray(0, 8).equals(pngSignature) || width !== expectedSize || height !== expectedSize) {
      errors.push(`桌面图标尺寸错误：${label} 应为 ${expectedSize}x${expectedSize}，实际 ${width}x${height}`);
    }
  }
}

if (!fs.existsSync(MANIFEST)) {
  errors.push("缺少 src/manifest.json");
} else {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const configured = manifest?.["app-plus"]?.distribute?.icons?.android || {};
  for (const density of Object.keys(launchers)) {
    const expected = `static/brand/app-icons/${density}.png`;
    if (configured[density] !== expected) errors.push(`manifest Android ${density} 图标未指向 ${expected}`);
  }
}

if (!fs.existsSync(COMPONENT)) {
  errors.push("缺少 src/components/app-icon.vue");
} else {
  const source = fs.readFileSync(COMPONENT, "utf8");
  if (!source.includes("<image")) errors.push("app-icon.vue 必须使用 uni-app image 组件渲染");
  if (!source.includes("/static/icons/")) errors.push("app-icon.vue 没有指向 /static/icons/ 静态资源");
}

if (errors.length) {
  process.stderr.write("OA_ICONS_FAILED\n");
  for (const error of errors) process.stderr.write(`  - ${error}\n`);
  process.exit(1);
}

process.stdout.write(`OA_ICONS_OK icons=${names.length} variants=${variants.length} assets=${names.length * variants.length} launchers=${Object.keys(launchers).length}\n`);
