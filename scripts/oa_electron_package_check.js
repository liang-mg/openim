#!/usr/bin/env node
/**
 * Electron 打包完整性回归
 *
 * 验证打好的 Windows asar 里，运行时闭包的所有依赖包都有物理文件。
 * 这类检查能杜绝 "Cannot find module 'xxx'" 启动崩溃——之前连续踩过
 * @babel/runtime、conf、dot-prop 等传递依赖漏打包的坑。
 *
 * 原理：读取 electron-build.mjs 的 dry-run 依赖清单，逐个到 asar 的
 * 文件列表里找 node_modules/<name>/package.json。找不到即失败。
 *
 * 用法：
 *   node scripts/oa_electron_package_check.js
 *   （需先打好包：node scripts/electron-build.mjs --skip-build --win --x64）
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
// 打包产物只存在于开发机的大仓源码目录，不会进协作仓。
// 依次按：命令行参数 → 环境变量 → 常见相对位置 探测 APP 路径。
const APP = (() => {
  const fromArg = process.argv[2];
  const fromEnv = process.env.OA_ELECTRON_APP;
  if (fromArg) return path.resolve(fromArg);
  if (fromEnv) return path.resolve(fromEnv);
  const candidates = [
    path.join(ROOT, "src/openim-electron-demo"),
    path.join(ROOT, "../src/openim-electron-demo"),
  ];
  return candidates.find((p) => fs.existsSync(p)) || candidates[0];
})();
const ASAR = path.join(
  APP,
  "release/Base/3.8.3/win-unpacked/resources/app.asar",
);
const ASAR_MODULE = path.join(
  APP,
  "node_modules/.pnpm/asar@3.2.0/node_modules/asar/lib/asar.js",
);
const BUILD_SCRIPT = path.join(APP, "scripts/electron-build.mjs");

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`PASS  ${name} ${detail}`);
  } else {
    fail++;
    console.log(`FAIL  ${name} ${detail}`);
  }
};

// 1. asar 存在
if (!fs.existsSync(ASAR)) {
  console.error(`FAIL  找不到 asar: ${ASAR}\n请先执行打包。`);
  process.exit(1);
}
ok("asar 文件存在", true, `(${(fs.statSync(ASAR).size / 1024 / 1024).toFixed(1)}MB)`);

// 2. 取运行时依赖清单（从 dry-run 输出解析）
const dry = spawnSync(process.execPath, [BUILD_SCRIPT, "--dry-run", "--win", "--x64"], {
  cwd: APP,
  encoding: "utf8",
});
const line = (dry.stdout || "").split("\n").find((l) => l.includes("runtime dependencies"));
ok("能读取依赖清单", !!line);
const deps = line
  ? line.split(":")[1].split(",").map((s) => s.trim()).filter(Boolean)
  : [];
ok("依赖清单非空", deps.length > 0, `(${deps.length} 个)`);

// 3. 读 asar 文件列表
const asar = require(ASAR_MODULE);
const files = asar.listPackage(ASAR).map((f) => f.replace(/\\/g, "/").toLowerCase());

// 4. 逐个依赖验证 node_modules/<name>/package.json 存在
for (const name of deps) {
  const needle = `/node_modules/${name.replace("/", "/")}/package.json`.toLowerCase();
  const hit = files.some((f) => f.endsWith(needle));
  ok(`依赖已打包: ${name}`, hit);
}

// 5. 关键的易漏模块单独点名（防止清单本身算错）
for (const must of [
  "@babel/runtime/helpers/typeof.js",
  "conf/package.json",
  "dot-prop/package.json",
  "electron-store/package.json",
  "i18next/package.json",
]) {
  const needle = `/node_modules/${must}`.toLowerCase();
  ok(`关键模块: ${must}`, files.some((f) => f.endsWith(needle)));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
