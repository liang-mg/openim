/**
 * 底部 tab 页切换工具。
 *
 * 以前用 uni.reLaunch 切 tab：每次都销毁/重建页面，IM 页面首屏再拉一遍
 * connect/list，主观上非常“重”。现在把 message/contact/work/mine 注册成
 * 真正的 tabBar 页面，用 switchTab 切换，页面实例会保留，切回来不再重建。
 * 原生 tabBar 隐藏，仍用项目自己的 app-tabbar（保设计）。
 */
export function hideNativeTabBar() {
  try {
    uni.hideTabBar({ animation: false });
  } catch (e) {
    /* 非 tabBar 页面或平台不支持时忽略 */
  }
}

export function switchTab(path) {
  uni.switchTab({
    url: path,
    fail: () => {
      // 极端情况下（旧基座/tabBar 未注册）退回 reLaunch，保证能到页面
      uni.reLaunch({ url: path });
    },
  });
}

export default { hideNativeTabBar, switchTab, preloadTabPages };

let preloaded = false;

/**
 * 空闲时预热另外三个 tab 页。tabBar + switchTab 已经避免重复创建，
 * 这里再把首次切过去要加载的页面资源提前拉好，减少第一次点击的白屏/卡顿。
 */
export function preloadTabPages() {
  if (preloaded) return;
  preloaded = true;
  if (typeof uni.preloadPage !== "function") return;
  const pages = ["/pages/contact/index", "/pages/work/index", "/pages/mine/index"];
  setTimeout(() => {
    pages.forEach((url) => {
      try {
        uni.preloadPage({ url });
      } catch (e) {
        /* 平台不支持时忽略 */
      }
    });
  }, 900);
}
