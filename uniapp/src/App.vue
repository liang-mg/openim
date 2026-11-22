<script>
import { CONFIG } from "@/config";
import { getToken } from "@/utils/storage";
import { on as onIM, ensureConnection } from "@/api/im";
import { useIMStore } from "@/store/im";

let offAuth = null;
let hiddenAt = 0;

export default {
  onLaunch() {
    // 未读/申请红点全局 store：reLaunch 切 tab 后仍然保留
    try {
      useIMStore().bind();
    } catch (e) {
      /* Pinia 未就绪时忽略，页面 onShow 还会兜底 */
    }
    // 全局只做「有没有登录态」的粗判；具体跳转放在页面 onShow，
    // 避免首屏还没渲染完就 reLaunch 造成闪屏（PC 端踩过同样的坑）。
    const token = getToken();
    if (!token) {
      // 登录页自己不会触发这里，防止死循环
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      if (current && !String(current.route || "").includes("pages/login")) {
        uni.reLaunch({ url: "/pages/login/index" });
      }
    }
    // 被踢下线 / token 过期：适配层已经清了登录态，这里负责提示并回登录页
    if (!offAuth) {
      offAuth = onIM("auth", ({ type } = {}) => {
        try {
          useIMStore().reset();
        } catch (e) {
          /* ignore */
        }
        const title = type === "kicked" ? "账号已在其他设备登录" : "登录已失效，请重新登录";
        uni.showToast({ title, icon: "none", duration: 2600 });
        setTimeout(() => uni.reLaunch({ url: "/pages/login/index" }), 700);
      });
    }
    // #ifdef H5
    // 排查「这个包连的是哪套环境」时，在控制台看 window.__oaConfig__ 即可
    if (typeof window !== "undefined") window.__oaConfig__ = CONFIG;
    // #endif
  },
  onShow() {
    // 从后台/VPN 切换回来时检查一次真实连接；没连上会走 ensureConnection 的重连
    if (getToken()) {
      hiddenAt = 0;
      ensureConnection().catch(() => {});
    }
  },
  onHide() {
    hiddenAt = Date.now();
  },
  onError(err) {
    console.error("[oa] app error", err);
  },
};
</script>

<style>
/* ============================================================
   设计变量 —— 与 frontend/ 保持同一套品牌色
   ============================================================ */
page,
:root {
  --brand: #0b5fd8;
  --brand-dark: #0848a8;
  --brand-soft: #eaf2fe;
  --primary: #0089ff;
  --ink: #1f2329;
  --ink-2: #5c6370;
  --ink-3: #8a9099;
  --ink-4: #b6bcc6;
  --line: #eef0f3;
  --bg: #f4f6f9;
  --card: #ffffff;
  --danger: #e34d59;
  --danger-soft: #fdecee;
  --warn: #f5a623;
  --warn-text: #a56500;
  --warn-soft: #fff6e5;
  --ok: #22a06b;
  --ok-text: #12a870;
  --ok-soft: #e8f7ee;
  --info-soft: #eaf4ff;
  --fill: #f7f9fc;
  --fill-2: #f2f5f9;
  /* 深一档的墨色/橙色/描边：状态文字与浅色控件用，别再散落 hex */
  --ink-strong: #12233f;
  --warn-strong: #d97706;
  --line-2: #d9dee7;
  --radius: 12px;
  --sub-text: #8a96ab;
  /* 排版 token：所有页面统一从这里取，不依赖浏览器默认字体/字号 */
  --font-sans: "HarmonyOS Sans SC", "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
  --font-number: "SF Pro Display", "HarmonyOS Sans SC", "PingFang SC", Arial, sans-serif;
  --text-2xs: 10px;
  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 14px;
  --text-lg: 16px;
  --text-xl: 18px;
  --weight-regular: 400;
  --weight-medium: 500;
  --weight-semibold: 600;
  --radius-sm: 6px;
  --radius-ctl: 8px;
  --radius-card: 12px;
  --shadow-card: 0 4px 16px rgba(20, 48, 92, 0.06);
}

page {
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-sans);
  font-size: var(--text-md);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
}

input,
textarea,
button {
  font-family: var(--font-sans);
  color: var(--ink);
}

view,
text,
input,
textarea,
scroll-view {
  box-sizing: border-box;
}

::-webkit-scrollbar {
  width: 0;
  height: 0;
  background: transparent;
}

/* ============================================================
   页面骨架：整页滚动，头部 sticky，底部 tabbar fixed
   —— 不要用 height:100vh + 内部 scroll-view 的「固定高度壳」。
      真机上 100vh 会被地址栏、软键盘、安全区不断改写，
      外层写死高度再套一层内部滚动，就是「内容溢出 / 滑不动 /
      键盘挡住输入框」最常见的来源（React 版打包成 APK 后踩过）。
   —— 约定：页面用文档流滚动；给 tabbar 留 .page-bottom-space。
   ============================================================ */
.app-page {
  position: relative;
  width: 100%;
  max-width: 480px;
  min-height: 100%;
  margin: 0 auto;
  background: var(--bg);
  animation: oa-page-in 0.18s ease-out both;
}

@keyframes oa-page-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .app-page { animation: none; }
}

/* 只在桌面浏览器里做「手机壳」效果；真机不加阴影，少一次大范围合成 */
@media (min-width: 600px) {
  .app-page {
    box-shadow: 0 0 0 1px rgba(15, 35, 70, 0.05), 0 24px 80px rgba(15, 35, 70, 0.12);
  }
}

/* 顶部导航：sticky，跟着页面滚但始终可见，不做 fixed（fixed 在 iOS 上会有跳变） */
.app-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  height: calc(52px + var(--status-bar-height, 0px));
  padding: var(--status-bar-height, 0px) 14px 0;
  background: var(--card);
  border-bottom: 1px solid var(--line);
}

.app-header__title {
  flex: 1;
  min-width: 0;
  font-size: 17px;
  font-weight: 600;
  color: var(--ink);
  text-align: center;
}

.app-header__side {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 44px;
}

/* 蓝底顶部栏（工作台 / 消息 / 打卡用） */
.app-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: calc(52px + var(--status-bar-height, 0px));
  padding: var(--status-bar-height, 0px) 14px 0;
  background: var(--brand);
  color: #fff;
}

.app-topbar__title {
  font-size: 16px;
  font-weight: 600;
}

/* 内容区 */
.app-content {
  padding: 12px 14px;
}

/* 给固定底部 tabbar 留位置（56 + 安全区），必须由页面自己加 */
.page-bottom-space {
  height: calc(56px + env(safe-area-inset-bottom));
}

/* ============================================================
   通用小组件
   ============================================================ */
.card {
  background: var(--card);
  border-radius: var(--radius);
  padding: 14px;
}

.muted {
  color: var(--ink-3);
  font-size: 12px;
}

.tag {
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 4px;
  font-size: 10px;
  line-height: 1;
  color: var(--ink-3);
  background: #f2f4f7;
}

.tag--brand {
  color: var(--brand);
  background: var(--brand-soft);
}

.tag--warn {
  color: #a56500;
  background: #fff6e5;
}

.divider {
  height: 1px;
  background: var(--line);
}

.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 64px 20px;
  color: var(--ink-3);
  font-size: 13px;
}

.safe-bottom {
  padding-bottom: env(safe-area-inset-bottom);
}

/* 去掉 uni button 默认边框与背景 */
button.plain-btn {
  margin: 0;
  padding: 0;
  background: transparent;
  border: none;
  line-height: normal;
  font-size: inherit;
  color: inherit;
}

button.plain-btn::after {
  border: none;
}

.primary-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 46px;
  border-radius: 10px;
  background: var(--brand);
  color: #fff;
  font-size: 16px;
  font-weight: 500;
}

.primary-btn--ghost {
  background: var(--brand-soft);
  color: var(--brand);
}

.primary-btn--disabled {
  opacity: 0.5;
}
</style>
