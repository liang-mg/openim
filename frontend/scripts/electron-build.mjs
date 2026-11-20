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
  const dependencyNames = new Set();
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
    dependencyNames.add(manifest.name ?? packageName);
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
  return dependencyNames;
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
  const runtimePackageNames = new Set(importedPackageNames);

  // electron-builder 23 flattens pnpm's dependency tree. Promote any explicitly
  // declared dependency in the runtime closure so the intended version wins over
  // a conflicting development dependency hoisted at the workspace root.
  for (const packageName of Object.keys(declaredDependencies)) {
    if (installedDependencyNames.has(packageName)) {
      runtimePackageNames.add(packageName);
    }
  }
  for (const packageName of [...runtimePackageNames].sort()) {
    const version =
      rootPackage.dependencies?.[packageName] ??
      rootPackage.optionalDependencies?.[packageName];
    if (!version) {
      throw new Error(
        `Electron runtime dependency ${packageName} must be declared in package.json`,
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
  for (const name of ["koffi", "rxjs"]) {
    const linkPath = path.join(repoRoot, "node_modules", name);
    if (existsSync(linkPath)) continue;
    const candidates = readdirSync(path.join(repoRoot, "node_modules", ".pnpm"))
      .filter((entry) => entry.startsWith(`${name}@`))
      .map((entry) =>
        path.join(repoRoot, "node_modules", ".pnpm", entry, "node_modules", name),
      )
      .filter(existsSync);
    if (!candidates.length) continue;
    try {
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
