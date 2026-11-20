import { app, session } from "electron";
import { join } from "node:path";
import { createMainWindow } from "./windowManage";
import { createTray } from "./trayManage";
import { setIpcMainListener } from "./ipcHandlerManage";
import { setAppGlobalData, setAppListener, setSingleInstance } from "./appManage";
import createAppMenu from "./menuManage";
import { isLinux } from "../utils";
import { getLogger } from "../utils/log";
import { initI18n } from "../i18n";

export const logger = getLogger(join(app.getPath("userData"), `/OpenIMData/logs`));

const init = () => {
  initI18n();
  createMainWindow();
  createAppMenu();
  createTray();
  if (process.env.OPENIM_SMOKE_TEST === "1") {
    process.stdout.write("OPENIM_ELECTRON_READY\n");
  }
};

setAppGlobalData();
setIpcMainListener();
setSingleInstance();
setAppListener(init);

app.whenReady().then(() => {
  // 打卡页用 file:// 加载，Chromium 对 opaque origin 的权限请求不会自动放行，
  // 不显式处理时 geolocation 会一直挂到 12 秒超时。只放行本应用自己的页面，
  // 且只放开打卡必须的定位/摄像头/通知，其他权限一律拒绝。
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const page = webContents.getURL();
    const ownPage = page.startsWith("file://") || page.startsWith("http://127.0.0.1");
    const needed = ["geolocation", "media", "notifications"].includes(permission);
    callback(ownPage && needed);
  });
  isLinux ? setTimeout(init, 300) : init();
});
