import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 纯 Web 开发配置：去掉 electron 插件，避免 dev 时拉起桌面窗口。
// 用法：npx vite --config vite.web.config.ts --host 127.0.0.1 --port 5173
export default defineConfig({
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
  plugins: [react()],
  // 同源反代：让通过公网隧道访问的前端，接口都走当前域名，
  // 避免浏览器把 127.0.0.1:10002 当成访问者自己的机器。
  // 路径规则与 frontend-custom/nginx/site.conf 保持一致。
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": { target: "http://127.0.0.1:10002", changeOrigin: true, rewrite: (p) => p.replace(/^\/api/, "") },
      "/chat": { target: "http://127.0.0.1:10008", changeOrigin: true, rewrite: (p) => p.replace(/^\/chat/, "") },
      "/complete_admin": { target: "http://127.0.0.1:10009", changeOrigin: true, rewrite: (p) => p.replace(/^\/complete_admin/, "") },
      "/msg_gateway": { target: "ws://127.0.0.1:10001", ws: true, changeOrigin: true },
      "/oss": { target: "http://127.0.0.1:10005", changeOrigin: true, rewrite: (p) => p.replace(/^\/oss/, "") },
      "/livekit": { target: "ws://127.0.0.1:7880", ws: true, changeOrigin: true },
      // OA 业务服务（打卡、日报等），与 nginx 的 /oa/ 反代保持一致
      "/oa": { target: "http://127.0.0.1:10010", changeOrigin: true },
    },
  },
  clearScreen: false,
});
