/**
 * App 端运行时环境覆盖（H5 用 static/app-config.js，APK 用这里）。
 *
 * 为什么 APK 需要它：包内没有 nginx，「同源」不成立；而改包里的 app-config.js
 * 要重新签名。折中做法是把「环境」存进本地存储，启动时读：一次打包，可在
 * 「我的 → 长按版本号」里切换后端地址，重启生效（QA/内网多环境够用）。
 *
 * 注意：这是**调试能力**，生产包若不需要可以删掉 mine 页的入口；
 * 覆盖值只影响接口地址，不影响权限（权限永远在服务端判）。
 */
const KEY = "oa_runtime_override";

/** 读取覆盖值；无则 null
 *  兼容两种落盘：uni 自己写的 `{type,data}` 包装，以及外部/脚本直接写的 JSON 字符串
 *  （uni H5 的 getStorageSync 对没有 type 字段的裸 JSON 会原样返回字符串） */
export function getOverride() {
  try {
    let v = uni.getStorageSync(KEY);
    if (typeof v === "string" && v.trim().startsWith("{")) {
      try {
        v = JSON.parse(v);
      } catch (e) {
        return null;
      }
    }
    if (v && typeof v === "object" && v.data !== undefined && v.type) {
      // uni 的 {type,data} 包装
      return typeof v.data === "object" ? v.data : null;
    }
    return v && typeof v === "object" ? v : null;
  } catch (e) {
    return null;
  }
}

/** 写入覆盖值（全部传空表示「恢复默认」） */
export function setOverride({ apiOrigin = "", imOrigin = "", env = "", imMode = "" } = {}) {
  const origin = String(apiOrigin || "").trim().replace(/\/$/, "");
  const im = String(imOrigin || "").trim().replace(/\/$/, "");
  const mode = String(imMode || "").trim();
  if (mode && !["mock", "api", "sdk"].includes(mode)) {
    throw new Error("imMode 只能是 mock / api / sdk");
  }
  if (!origin && !im && !mode) {
    clearOverride();
    return null;
  }
  for (const [label, value] of [["业务地址", origin], ["IM 地址", im]]) {
    if (value && !/^https?:\/\//.test(value)) {
      throw new Error(`${label}必须以 http:// 或 https:// 开头`);
    }
  }
  const value = { apiOrigin: origin, imOrigin: im, env: env || "custom", imMode: mode };
  uni.setStorageSync(KEY, value);
  return value;
}

export function clearOverride() {
  try {
    uni.removeStorageSync(KEY);
  } catch (e) {
    /* ignore */
  }
}

export default { getOverride, setOverride, clearOverride };
