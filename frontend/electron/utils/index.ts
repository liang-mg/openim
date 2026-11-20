import { app } from "electron";

export const isLinux = process.platform == "linux";
export const isWin = process.platform == "win32";
export const isMac = process.platform == "darwin";

/**
 * 是否处于打包后的生产环境。
 *
 * 本模块同时被「主进程」和「preload」引用：preload 上下文中没有 `app` 对象
 * （直接读 app.isPackaged 会抛 TypeError，导致整个 preload 加载失败、
 * window.electronAPI 不注入，登录页既没有服务器地址输入框也点不动）。
 *
 * 因此：
 * - 主进程：`app` 可用，用 app.isPackaged（最准确）；
 * - preload：`app` 为 undefined，用 process.defaultApp 兜底
 *   （开发态为 true，打包后为 undefined/false）。
 */
export const isProd = (() => {
  try {
    if (app && typeof app.isPackaged === "boolean") return app.isPackaged;
  } catch (_) {
    // preload 中 import { app } 得到 undefined，落到下面的兜底
  }
  return !process.defaultApp;
})();
