#!/usr/bin/env node

import { builtinModules, createRequire } from "node:module";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(repoRoot, "package.json");
const backupPath = path.join(repoRoot, ".electron-package.backup.json");
const electronOutputPath = path.join(repoRoot, "dist-electron");
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
// 直接用 node 启动 electron-builder 的 cli.js，不依赖 .cmd/.sh 启动器：
// 部分受限环境会拦截 .cmd 创建子进程，用 process.execPath 启动更稳。
const electronBuilderCli = createRequire(packagePath).resolve(
  "electron-builder/cli.js",
);

const rawArgs = process.argv.slice(2).filter((arg) => arg !== "--");
const dryRun = rawArgs.includes("--dry-run");
const buildAll = rawArgs.includes("--all");
// --skip-build：复用已有的 dist / dist-electron 产物，只做打包。
// 用于已手动构建过、或受限环境下 pnpm 无法再次构建的场景。
const skipBuild = rawArgs.includes("--skip-build");
const forwardedArgs = rawArgs.filter(
  (arg) => arg !== "--dry-run" && arg !== "--all" && arg !== "--skip-build",
);

const run = (command, args) => {
  console.log(`> ${path.basename(command)} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${path.basename(command)} exited with code ${result.status ?? 1}`);
  }
};

const getJavaScriptFiles = (directory) => {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...getJavaScriptFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }
  return files;
};

const builtinPackages = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
  "electron",
]);

const toPackageName = (specifier) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];

const detectRuntimePackageNames = () => {
  if (!existsSync(electronOutputPath)) {
    throw new Error("dist-electron is missing; run pnpm build first");
  }

  const packageNames = new Set();
  const importPattern = /\b(?:require|import)\(\s*["']([^"']+)["']\s*\)/g;
  for (const filePath of getJavaScriptFiles(electronOutputPath)) {
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(importPattern)) {
      const specifier = match[1];
      if (
        specifier.startsWith(".") ||
        specifier.startsWith("/") ||
        builtinPackages.has(specifier)
      ) {
        continue;
      }
      packageNames.add(toPackageName(specifier));
    }
  }
  return [...packageNames].sort();
};

const resolvePackageManifestPath = (packageName, requiringManifestPath) => {
  const packageRequire = createRequire(requiringManifestPath);
  try {
    return packageRequire.resolve(`${packageName}/package.json`);
  } catch (error) {
    if (error?.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") {
      throw error;
    }
  }

  let currentPath = path.dirname(packageRequire.resolve(packageName));
  while (true) {
    const manifestPath = path.join(currentPath, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === packageName) {
        return manifestPath;
      }
    }
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) break;
    currentPath = parentPath;
  }
  throw new Error(`Unable to resolve package manifest for ${packageName}`);
};

const collectInstalledDependencyNames = (rootPackageNames) => {
  /** name -> 实际安装版本。传递依赖（如 i18next 依赖的 @babel/runtime）不在根
   * package.json 声明，必须带上真实版本，否则精简 manifest 会漏掉它们，
   * electron-builder 就不会把它们打进 asar，运行时报 Cannot find module。 */
  const dependencies = new Map();
  const visitedManifests = new Set();

  const visit = (packageName, requiringManifestPath, optional = false) => {
    let manifestPath;
    try {
      manifestPath = resolvePackageManifestPath(packageName, requiringManifestPath);
    } catch (error) {
      if (optional) return;
      throw new Error(
        `Unable to resolve runtime dependency ${packageName}: ${error.message}`,
      );
    }
    if (visitedManifests.has(manifestPath)) return;
    visitedManifests.add(manifestPath);

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const name = manifest.name ?? packageName;
    if (!dependencies.has(name) && manifest.version) {
      dependencies.set(name, `^${manifest.version}`);
    }
    for (const dependencyName of Object.keys(manifest.dependencies ?? {})) {
      visit(dependencyName, manifestPath);
    }
    for (const dependencyName of Object.keys(manifest.optionalDependencies ?? {})) {
      visit(dependencyName, manifestPath, true);
    }
  };

  for (const packageName of rootPackageNames) {
    visit(packageName, packagePath);
  }
  return dependencies;
};

const createRuntimeManifest = (rootPackage) => {
  const dependencies = {};
  const importedPackageNames = detectRuntimePackageNames();
  const installedDependencyNames =
    collectInstalledDependencyNames(importedPackageNames);
  const declaredDependencies = {
    ...rootPackage.dependencies,
    ...rootPackage.optionalDependencies,
  };
  // 运行时闭包 = 直接 import + 它们的全部传递依赖（含 @babel/runtime 这类
  // 未声明在根 package.json 的包）。全部写进精简 manifest，electron-builder
  // 才会把它们打进 asar，避免启动期 Cannot find module。
  const runtimePackageNames = new Set(importedPackageNames);
  for (const packageName of installedDependencyNames.keys()) {
    runtimePackageNames.add(packageName);
  }

  for (const packageName of [...runtimePackageNames].sort()) {
    // 根 package.json 显式声明的版本优先（与开发期 semver 保持一致），
    // 否则用实际安装到的版本（传递依赖走这里）。
    const version =
      declaredDependencies[packageName] ??
      installedDependencyNames.get(packageName);
    if (!version) {
      throw new Error(
        `Electron runtime dependency ${packageName} has no resolvable version`,
      );
    }
    dependencies[packageName] = version;
  }

  const manifest = { dependencies };
  for (const key of [
    "name",
    "version",
    "main",
    "description",
    "author",
    "license",
    "homepage",
    "private",
    "build",
  ]) {
    if (rootPackage[key] !== undefined) {
      manifest[key] = rootPackage[key];
    }
  }
  return manifest;
};

const ensurePublishMode = (args) => {
  if (args.some((arg) => arg === "--publish" || arg.startsWith("--publish="))) {
    return args;
  }
  return [...args, "--publish", "never"];
};

const getBuilderCommands = () => {
  const extraArgs = ensurePublishMode(forwardedArgs);
  const commands = buildAll
    ? [
        ["--win", "--x64", ...extraArgs],
        ["--mac", "--x64", "--arm64", ...extraArgs],
        ["--linux", "--x64", ...extraArgs],
        ["--linux", "--arm64", ...extraArgs],
      ]
    : [extraArgs];
  for (const args of commands) {
    if (args.includes("--win") && args.includes("--arm64")) {
      throw new Error("Windows arm64 is not supported by the OpenIM native SDK");
    }
  }
  return commands;
};

const restoreStaleBackup = () => {
  if (!existsSync(backupPath)) return;
  console.warn("Restoring package.json left by an interrupted Electron build");
  copyFileSync(backupPath, packagePath);
  unlinkSync(backupPath);
};

restoreStaleBackup();
const builderCommands = getBuilderCommands();

/**
 * pnpm 会把依赖提升到 node_modules/.pnpm/<pkg>@<ver>/node_modules/<pkg>，
 * 但 electron-builder.json5 的 files/extraResources 用的是 node_modules/<pkg> 路径。
 * 打包期间给这些包建顶层目录链接，结束后移除，避免原生库（koffi.node）漏打包。
 */
const ensurePnpmTopLevelLinks = () => {
  const created = [];
  // scoped 包（如 @babel/runtime）的顶层目录是 @babel，链接到 scope 目录本身。
  const linkTargets = ["koffi", "rxjs", "@babel/runtime"];
  for (const name of linkTargets) {
    const linkPath = path.join(repoRoot, "node_modules", name);
    if (existsSync(linkPath)) continue;
    const isScoped = name.startsWith("@");
    const scope = isScoped ? name.split("/")[0] : name;
    const leaf = isScoped ? name.split("/")[1] : name;
    const candidates = readdirSync(path.join(repoRoot, "node_modules", ".pnpm"))
      .filter((entry) => entry.startsWith(`${name.replace("/", "+")}@`))
      .map((entry) =>
        path.join(repoRoot, "node_modules", ".pnpm", entry, "node_modules", name),
      )
      .filter(existsSync);
    if (!candidates.length) continue;
    try {
      if (isScoped) {
        mkdirSync(path.join(repoRoot, "node_modules", scope), { recursive: true });
      }
      symlinkSync(candidates[0], linkPath, "junction");
      created.push(linkPath);
      console.log(`Linked node_modules/${name} -> ${path.basename(path.dirname(candidates[0]))}`);
    } catch (error) {
      console.warn(`Unable to link node_modules/${name}: ${error.message}`);
    }
  }
  return created;
};

if (!dryRun && !skipBuild) {
  run(pnpmCommand, ["build"]);
}

const originalPackageText = readFileSync(packagePath, "utf8");
const rootPackage = JSON.parse(originalPackageText);
const runtimeManifest = createRuntimeManifest(rootPackage);

console.log(
  `Electron runtime dependencies: ${Object.keys(runtimeManifest.dependencies).join(
    ", ",
  )}`,
);

if (dryRun) {
  for (const args of builderCommands) {
    console.log(`Would run: electron-builder ${args.join(" ")}`);
  }
  process.exit(0);
}

writeFileSync(backupPath, originalPackageText);
const links = ensurePnpmTopLevelLinks();
let exitCode = 0;
try {
  writeFileSync(packagePath, `${JSON.stringify(runtimeManifest, null, 2)}\n`);
  for (const args of builderCommands) {
    run(process.execPath, [electronBuilderCli, ...args]);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  exitCode = 1;
} finally {
  copyFileSync(backupPath, packagePath);
  unlinkSync(backupPath);
  for (const link of links) {
    try {
      unlinkSync(link);
    } catch {
      // junction 删除失败可忽略，下次打包会复用
    }
  }
  console.log("Restored development package.json");
}

process.exit(exitCode);
