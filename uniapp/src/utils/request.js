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

/** 只展示协议、主机和端口，既方便排障，也避免把接口路径或查询参数带给用户。 */
function backendLabel(url) {
  try {
    const parsed = new URL(url);
    return parsed.host || parsed.origin;
  } catch (e) {
    return CONFIG.origin || "当前后端";
  }
}

function networkError(raw, url) {
  const target = backendLabel(url);
  let message = `后端连接失败（${target}），请确认服务已启动且手机与服务器网络互通`;
  let code = "BACKEND_UNREACHABLE";
  if (raw.includes("timeout")) {
    message = `后端请求超时（${target}），请检查服务器或网络`;
    code = "BACKEND_TIMEOUT";
  } else if (raw.includes("abort")) {
    message = "请求已取消";
    code = "REQUEST_ABORTED";
  } else if (raw.includes("domain") || raw.includes("url not in")) {
    message = `后端地址不可用（${target}），请联系管理员检查配置`;
    code = "BACKEND_ADDRESS_INVALID";
  }
  const error = new Error(message);
  error.code = code;
  error.rawMessage = raw;
  error.detail = { url, bodyPreview: raw.slice(0, 180) };
  return error;
}

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
        const contentType = String((res.header && (res.header["content-type"] || res.header["Content-Type"])) || "");

        if (status === 401) {
          goLogin();
          reject(new Error("登录已失效，请重新登录"));
          return;
        }
        if (status < 200 || status >= 300) {
          const e = new Error(`请求失败（${status}）`);
          e.detail = { url, httpStatus: status, contentType, bodyPreview: String(typeof body === "string" ? body : JSON.stringify(body || {})).slice(0, 180) };
          reject(e);
          return;
        }
        // 静态站点/网关把 API 回落成 HTML 时，提前给出可诊断的错误，避免解析成“登录缺少字段”
        if (typeof body === "string" && /^\s*</.test(body)) {
          const e = new Error("接口返回了 HTML 而不是 JSON");
          e.code = "HTML_RESPONSE";
          e.detail = { url, httpStatus: status, contentType: contentType || "text/html", bodyPreview: body.slice(0, 180) };
          reject(e);
          return;
        }
        // 信封格式
        if (body && typeof body === "object" && "code" in body) {
          if (body.code === 0) {
            resolve(body.data);
            return;
          }
          if (body.code === 401) goLogin();
          const e = new Error(body.msg || "请求失败");
          e.detail = { url, httpStatus: status, contentType, bodyPreview: JSON.stringify(body).slice(0, 180) };
          reject(e);
          return;
        }
        // 非信封（例如直接返回数组）
        resolve(body);
      },
      fail: (err) => {
        // uni 的 errMsg 是 request:fail xxx 这种原始串，不直接弹出；
        // 但保留可识别的错误类型和目标主机，定位页可以准确区分 GPS 与后端故障。
        const raw = String((err && err.errMsg) || "");
        reject(networkError(raw, url));
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

/**
 * OpenIM 的 chat API 要求每个请求带 operationID（PC 端在 api/login.ts 里用 uuidv4()）。
 * 不带时 IM 会直接返回 1001 ArgsError: header must have operationID，
 * 表现为「登录一直失败但账号密码没错」。H5 / App 都要能生成，故做降级实现。
 */
function operationID() {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (e) {
    /* 老 WebView 没有 crypto.randomUUID，走下面的降级 */
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/** IM（chat）接口：登录/注册等，地址前缀不同 */
export const chatPost = (path, data, options = {}) =>
  request({
    ...options,
    path,
    data,
    method: "POST",
    base: CONFIG.chatBase,
    header: { operationID: operationID(), ...(options.header || {}) },
  });

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
