import { rmSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import electron from "vite-electron-plugin";
import { customStart, loadViteEnv } from "vite-electron-plugin/plugin";
import pkg from "./package.json";
import legacy from "@vitejs/plugin-legacy";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
// import visualizer from "rollup-plugin-visualizer";

// https://vitejs.dev/config/
export default defineConfig(({ command }) => {
  rmSync("dist-electron", { recursive: true, force: true });

  const sourcemap = command === "serve" || !!process.env.VSCODE_DEBUG;

  return {
    resolve: {
      alias: {
        "@": path.join(__dirname, "src"),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          silenceDeprecations: ["legacy-js-api"],
        },
      },
    },
    plugins: [
      react(),
      electron({
        include: ["electron"],
        transformOptions: {
          sourcemap,
        },
        plugins: [
          ...(!!process.env.VSCODE_DEBUG
            ? [
              // Will start Electron via VSCode Debug
              customStart(() =>
                console.log(
                    /* For `.vscode/.debug.script.mjs` */ "[startup] Electron App",
                ),
              ),
            ]
            : []),
          // Allow use `import.meta.env.VITE_SOME_KEY` in Electron-Main
          loadViteEnv(),
        ],
      }),
      // legacy({
      //   targets: ["defaults", "not IE 11"],
      // }),
      // visualizer({ open: true }),
    ],
    server: !!process.env.VSCODE_DEBUG
      ? (() => {
        const url = new URL(pkg.debug.env.VITE_DEV_SERVER_URL);
        return {
          host: url.hostname,
          port: +url.port,
        };
      })()
      : undefined,
    clearScreen: false,
    build: {
      // 不清空输出目录：沙箱环境下批量删文件会触发回收站保护导致超时。
      // 产物文件名带 hash，残留旧文件不影响运行结果。
      emptyOutDir: false,
      sourcemap: false,
      cssCodeSplit: true,
      chunkSizeWarningLimit: 500,
      terserOptions: {
        compress: {
          drop_console: true,
          drop_debugger: true,
        },
      },
      rollupOptions: {
        output: {
        },
      },
    },
  };
});
