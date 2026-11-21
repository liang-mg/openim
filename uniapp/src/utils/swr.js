/**
 * 页面数据缓存（stale-while-revalidate）。
 *
 * 为什么需要：`uni.reLaunch` 切 tab 会重建页面，每次都从「空白 → 请求 → 渲染」开始，
 * 在真机（尤其低端 Android）上就是点一下要等一下才出内容。
 * 做法：进页面先拿上次的数据**立即渲染**，同时在后台刷新；刷新回来再替换。
 * 用户感知：点进去就有内容，数据最多晚一个请求周期更新。
 *
 * 约定：
 *   - 只缓存「首屏列表/概览」这类幂等 GET 的结果，不缓存表单与提交结果；
 *   - maxAge 内不重复请求（默认 60s），切回来不闪；
 *   - 缓存只在本会话内存里，刷新页面即失效（不写 storage，避免脏数据）。
 */
const store = new Map();

/** 读缓存（没有则 undefined） */
export function peek(key) {
  const hit = store.get(key);
  return hit ? hit.data : undefined;
}

/** 写缓存 */
export function put(key, data) {
  store.set(key, { data, at: Date.now() });
}

/** 缓存是否在有效期内 */
export function isFresh(key, maxAge = 60 * 1000) {
  const hit = store.get(key);
  return Boolean(hit && Date.now() - hit.at < maxAge);
}

export function clear(key) {
  if (key) store.delete(key);
  else store.clear();
}

/**
 * 页面用的统一入口：
 *   const { data, fromCache } = await swr("work", load);
 *   fromCache=true 表示这次是从缓存拿的（可能还在后台刷新）
 */
export async function swr(key, loader, { maxAge = 60 * 1000 } = {}) {
  if (isFresh(key, maxAge)) {
    return { data: peek(key), fromCache: true };
  }
  const data = await loader();
  put(key, data);
  return { data, fromCache: false };
}

export default { peek, put, isFresh, clear, swr };
