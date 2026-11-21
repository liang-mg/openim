/**
 * 统一请求层（对应 frontend/src/utils/request.ts + oaApi.ts 里的 http 实例）。
 *
 * 约定：
 *   1. 所有地址都是同源相对路径（/oa/...、/chat/...），dev 由 vite proxy 转发；
 *   2. 鉴权统一走 header `token`（= IM 的 chatToken），后端用 OPENIM_SECRET 校验；
 *   3. 响应信封 { code, msg, data }，code !== 0 视为失败；
 *   4. 401（code 或 HTTP）清登录态并回登录页。
 */
import { CONFIG } from "@/config";
import { getToken, clearAuth } from "@/utils/storage";

let redirecting = false;

function goLogin() {
  if (redirecting) return;
  redirecting = true;
  clearAuth();
  uni.reLaunch({
    url: "/pages/login/index",
    complete: () => {
      setTimeout(() => {
        redirecting = false;
      }, 800);
    },
  });
}

function buildQuery(params) {
  if (!params) return "";
  const parts = [];
  Object.keys(params).forEach((key) => {
    const value = params[key];
    if (value === undefined || value === null || value === "") return;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value)}`);
  });
  return parts.length ? `?${parts.join("&")}` : "";
}

/**
 * @param {object} options
 * @param {string} options.path      以 / 开头的接口路径
 * @param {string} [options.base]    基础前缀，默认 OA 接口
 * @param {string} [options.method]
 * @param {object} [options.data]    body 或 query（GET 时自动拼到 URL）
 * @param {object} [options.params]  query 参数（GET 用）
 * @param {object} [options.header]
 * @param {boolean}[options.auth]    是否带 token，默认 true
 * @param {number} [options.timeout]
 */
export function request(options = {}) {
  const {
    path,
    base = CONFIG.oaBase,
    method = "GET",
    data,
    params,
    header = {},
    auth = true,
    timeout = 25000,
  } = options;

  const url = `${base.replace(/\/$/, "")}${path}${buildQuery(params)}`;
  const token = auth ? getToken() : "";

  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method,
      data,
      timeout,
      header: {
        "Content-Type": "application/json",
        ...(token ? { token } : {}),
        ...header,
      },
      success: (res) => {
        const status = res.statusCode;
        const body = res.data;

        if (status === 401) {
          goLogin();
          reject(new Error("登录已失效，请重新登录"));
          return;
        }
        if (status < 200 || status >= 300) {
          reject(new Error(`请求失败（${status}）`));
          return;
        }
        // 信封格式
        if (body && typeof body === "object" && "code" in body) {
          if (body.code === 0) {
            resolve(body.data);
            return;
          }
          if (body.code === 401) goLogin();
          reject(new Error(body.msg || "请求失败"));
          return;
        }
        // 非信封（例如直接返回数组）
        resolve(body);
      },
      fail: (err) => {
        // uni 的 errMsg 是 request:fail xxx 这种原始串，不能直接弹给用户
        const raw = String((err && err.errMsg) || "");
        let msg = "网络异常，请检查网络后重试";
        if (raw.includes("timeout")) msg = "请求超时，请稍后重试";
        else if (raw.includes("abort")) msg = "请求已取消";
        else if (raw.includes("domain") || raw.includes("url not in")) msg = "接口地址不可用，请联系管理员";
        reject(new Error(msg));
      },
    });
  });
}

export const get = (path, params, options = {}) =>
  request({ ...options, path, params, method: "GET" });

export const post = (path, data, options = {}) =>
  request({ ...options, path, data, method: "POST" });

export const put = (path, data, options = {}) =>
  request({ ...options, path, data, method: "PUT" });

export const del = (path, params, options = {}) =>
  request({ ...options, path, params, method: "DELETE" });

/** IM（chat）接口：登录/注册等，地址前缀不同 */
export const chatPost = (path, data, options = {}) =>
  request({ ...options, path, data, method: "POST", base: CONFIG.chatBase });

/**
 * 文件上传（multipart）。uni 的 uploadFile 不接受普通 request 的 body，
 * 这里单独封装，保持「返回 UploadedFile」的语义与 PC 端一致。
 */
export function uploadFile(filePath, scope = "report") {
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: `${CONFIG.oaBase.replace(/\/$/, "")}/files/upload`,
      filePath,
      name: "file",
      formData: { scope },
      header: { token: getToken() || "" },
      success: (res) => {
        let body;
        try {
          body = JSON.parse(res.data);
        } catch (e) {
          reject(new Error("上传返回格式异常"));
          return;
        }
        if (body && body.code === 0) resolve(body.data);
        else reject(new Error((body && body.msg) || "上传失败"));
      },
      fail: (err) => reject(new Error((err && err.errMsg) || "上传失败")),
    });
  });
}

export default { request, get, post, put, del, chatPost, uploadFile };
