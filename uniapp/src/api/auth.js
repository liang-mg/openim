/**
 * 登录 / 登出。
 *
 * 账号体系归 IM（openim-chat）管，OA 不自建账号 —— 这一点和 PC 端一致：
 *   POST /chat/account/login  ->  { chatToken, imToken, userID }
 *   chatToken 给 OA 接口当 token 头；imToken 给 IM SDK 登录。
 *
 * 本地没有 IM 服务时，用 .env.dev.local 里的 VITE_DEV_TOKEN 走「本地联调进入」，
 * 跳过 IM 登录，直接拿一张后端签好的 chatToken 进页面（仅 dev 生效）。
 */
import md5 from "md5";
import { CONFIG, HOME_PATH } from "@/config";
import { chatPost } from "@/utils/request";
import { setAuth } from "@/utils/storage";

const AREA_CODE = "+86";
// 平台号必须与 IM SDK 初始化一致：H5=5(Web)、Android=2、iOS=1
const PLATFORM_ID = CONFIG.imPlatformID;

/**
 * 账号密码登录。
 * @param {{ account: string, password: string }} payload 密码传明文，这里做 md5
 */
export async function loginByPassword({ account, password }) {
  const body = await chatPost("/account/login", {
    phoneNumber: String(account || "").trim(),
    password: md5(String(password || "").trim()),
    areaCode: AREA_CODE,
    platform: PLATFORM_ID,
  });

  // 两种后端版本：直接返回字段，或包在 data 里
  const data = body && body.userID ? body : body && body.data ? body.data : body;
  if (!data || !data.chatToken || !data.userID) {
    const e = new Error("登录返回缺少 chatToken / userID");
    e.detail = {
      url: `${CONFIG.chatBase}/account/login`,
      bodyType: typeof body,
      bodyPreview: String(typeof body === "string" ? body : JSON.stringify(body || {})).slice(0, 180),
    };
    throw e;
  }
  setAuth(data);
  return data;
}

/** 本地联调登录：用预置 token 直接进入（仅 dev） */
export function loginByDevToken() {
  if (!CONFIG.devToken) throw new Error("未配置 VITE_DEV_TOKEN");
  const data = {
    chatToken: CONFIG.devToken,
    imToken: CONFIG.devToken,
    userID: CONFIG.devUserId || "",
  };
  setAuth(data);
  return data;
}

/**
 * 登录失败的人话解释。
 *
 * 为什么单独做：登录打的是 IM 的 /chat/account/login，失败原因分三类，
 * 用户看到的却都是一句"登录失败"。三类原因对应完全不同的处理人：
 *   · IM 服务没起 → 找运维/部署（本机联调可以先点「本地联调进入」）
 *   · 账号或密码错 → 用户自己重试
 *   · 网络问题 → 换网络/稍后重试
 */
export function describeLoginError(err) {
  const msg = String((err && err.message) || "");
  if (/500|502|503|504|网络|超时|fail|ECONNREFUSED/i.test(msg)) {
    return "IM 登录服务不可达（/chat 接口）。请确认 openim-chat 已启动，本机联调可先用「本地联调进入」。";
  }
  if (/返回缺少|返回格式|不是 JSON|HTML|Unexpected token/i.test(msg)) {
    const target = CONFIG.rawImOrigin || CONFIG.rawOrigin || "同源";
    return `登录接口返回异常（当前地址：${target}）：可能连到了没有 IM 服务的地址（例如静态站点把 /chat 回落成了首页）。请检查接口地址配置，或在登录页点“恢复默认生产接口”。`;
  }
  if (/密码|password|凭证|credential/i.test(msg)) return "账号或密码错误，请重试。";
  if (/不存在|未注册|not\s*found/i.test(msg)) return "账号不存在，请联系管理员开通。";
  return msg || "登录失败，请稍后重试。";
}

export function goHome() {
  uni.switchTab({ url: HOME_PATH });
}
