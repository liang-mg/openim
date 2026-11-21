/**
 * 运行时环境配置（一次构建，多环境部署）。
 *
 * ⚠️ 这个文件是「部署时唯一要改的文件」——改完刷新页面即生效，不需要重新构建。
 *    它会被原样拷贝到 dist/static/app-config.js。
 *
 * 用法：
 *   1. npm run build:h5 出一次包；
 *   2. 把 dist/ 放到任意环境（dev / staging / prod），只改这个文件；
 *   3. App 端（APK）也可以改「我」页长按版本号里的同名配置（存本地，重启生效）。
 *
 * 字段说明：
 *   env        环境名，仅用于界面/日志标识
 *   apiOrigin  业务接口源（OA 后端：考勤/日报/审批/员工）。留空 = 同源。
 *   imOrigin   IM 服务源（登录 / 会话 / 消息 / 通讯录）。留空 = 跟随 apiOrigin。
 *              ★ 业务与登录是两套服务，可以分别指向不同域名。
 *   wsOrigin   IM WebSocket 源，留空时从 imOrigin 推导（http→ws / https→wss）
 *   imMode     mock（假数据）| api（后端站内通知）| sdk（OpenIM 插件）
 *   devToken   仅本地联调用；生产必须留空
 */
window.__OA_CONFIG__ = {
  env: "dev",
  apiOrigin: "",
  imOrigin: "",
  wsOrigin: "",
  imMode: "mock",
  devToken: "",
};
