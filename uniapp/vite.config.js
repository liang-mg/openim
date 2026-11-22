import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import uni from "@dcloudio/vite-plugin-uni";
import tailwindcss from "tailwindcss";
import autoprefixer from "autoprefixer";

/**
 * 移动端 H5 / App 开发服务器。
 *
 * 端口 5180：5173 留给 PC 端（frontend/），5174 常被其他项目占用。
 * 所有后端都走同源相对路径（/oa、/api、/chat、/msg_gateway...），
 * 与 frontend/nginx/site.conf 的反代规则保持一致 —— 这样同一份代码
 * 在 dev、浏览器、APK 里的请求路径完全一样，不用改地址。
 *
 * 环境文件优先级（后者覆盖前者）：
 *   .env                    通用
 *   .env.[mode]             当前模式（development / production）
 *   .env.dev                本地开发默认（可提交）
 *   .env.dev.local          仅本机（已 gitignore，占位见 .env.dev.local.example）
 */
export default defineConfig(({ mode }) => {
  // 标准 vite 环境文件
  const baseEnv = loadEnv(mode, process.cwd());
  // 额外的本地覆盖文件：.env.dev / .env.dev.local（生产构建不加载）
  const devEnv = mode === "production" ? {} : loadEnv("dev", process.cwd());
  const env = { ...baseEnv, ...devEnv };

  // 只把 VITE_ 开头的变量注入到前端代码里
  const define = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("VITE_")) {
      define[`import.meta.env.${key}`] = JSON.stringify(value);
    }
  }
  // uni 插件会用自己收集的 env 整体替换 import.meta.env（只读 .env 文件、不含进程环境变量），
  // 所以这里额外给一个普通全局常量：CI/命令行里 VITE_APP_ORIGIN=... 也能生效（打 APK 时用得上）
  define.__APP_ORIGIN__ = JSON.stringify(env.VITE_APP_ORIGIN || "");

  const origin = (key, fallback) => env[key] || fallback;

  return {
    define,
    plugins: [uni()],
    resolve: {
      alias: {
        // 兼容 @openim/client-sdk 里指向未发布 .js 的深层 import
        "@openim/protocol/lib/pb/sdkws/sdkws": path.resolve(
          process.cwd(),
          "src/shims/openim-protocol-sdkws.js"
        ),
      },
    },
    /**
     * Tailwind 必须在这里挂：uni 插件会用自己的 postcss 预设接管 css 处理，
     * 项目根的 postcss.config.js 不会被读取（实测 @apply 会原样留在产物里）。
     */
    css: {
      postcss: {
        plugins: [tailwindcss(), autoprefixer()],
      },
    },
    server: {
      host: "127.0.0.1",
      port: Number(env.VITE_DEV_PORT) || 5180,
      strictPort: true,
      // 忽略编辑器/工具写入时留下的临时目录，否则 Windows 上会 EBUSY 把 dev server 带崩
      watch: {
        ignored: ["**/.git/**", "**/node_modules/**", "**/*.tmpdir/**", "**/.*.tmp*"],
      },
      proxy: {
        // H5 开发切「线上」时走同源 /proxy，绕开生产站点的 CORS 限制。
        // /proxy/oa/... -> https://im.9ty.lol/oa/...；/proxy/msg_gateway 走 WS。
        "/proxy": {
          target: "https://im.9ty.lol",
          changeOrigin: true,
          secure: true,
          ws: true,
          rewrite: (p) => p.replace(/^\/proxy/, ""),
        },
        // OA 业务服务：后端路由自带 /oa 前缀，不能 rewrite
        "/oa": { target: origin("VITE_PROXY_OA", "http://127.0.0.1:10010"), changeOrigin: true },
        // IM 服务
        "/api": {
          target: origin("VITE_PROXY_IM_API", "http://127.0.0.1:10002"),
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
        "/chat": {
          target: origin("VITE_PROXY_IM_CHAT", "http://127.0.0.1:10008"),
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/chat/, ""),
        },
        "/complete_admin": {
          target: origin("VITE_PROXY_IM_ADMIN", "http://127.0.0.1:10009"),
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/complete_admin/, ""),
        },
        "/msg_gateway": {
          target: origin("VITE_PROXY_IM_WS", "ws://127.0.0.1:10001"),
          ws: true,
          changeOrigin: true,
        },
        "/oss": {
          target: origin("VITE_PROXY_OSS", "http://127.0.0.1:10005"),
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/oss/, ""),
        },
        "/livekit": {
          target: origin("VITE_PROXY_LIVEKIT", "ws://127.0.0.1:7880"),
          ws: true,
          changeOrigin: true,
        },
      },
    },
  };
});
