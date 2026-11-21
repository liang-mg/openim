/**
 * 本地存储。
 *
 * 与 PC 端（frontend/src/utils/storage.ts）保持同一套语义：
 *   token     = chatToken，OA 接口鉴权用（后端用 OPENIM_SECRET 校验）
 *   userId    = IM userID
 *   imToken   = IM SDK 登录用，和 chatToken 不是同一个东西
 *
 * uni 的 getStorageSync 在 H5 落在 localStorage，App 落在原生存储。
 */

import { clear as clearPageCache } from "./swr";

const K_TOKEN = "oa_chat_token";
const K_IM_TOKEN = "oa_im_token";
const K_USER_ID = "oa_user_id";
const K_PHONE = "oa_login_account";
const K_PROFILE = "oa_profile";

const get = (key, fallback = "") => {
  try {
    const v = uni.getStorageSync(key);
    return v === "" || v === undefined || v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
};

const set = (key, value) => {
  try {
    uni.setStorageSync(key, value);
  } catch (e) {
    console.warn("[storage] set failed", key, e);
  }
};

const remove = (key) => {
  try {
    uni.removeStorageSync(key);
  } catch (e) {
    /* ignore */
  }
};

export const getToken = () => get(K_TOKEN);
export const getIMToken = () => get(K_IM_TOKEN);
export const getUserId = () => get(K_USER_ID);
export const getLoginAccount = () => get(K_PHONE);
export const setLoginAccount = (account) => set(K_PHONE, account);

/** 一次写入整套登录态（登录成功 / 本地联调时调用） */
export const setAuth = ({ chatToken, imToken, userID }) => {
  set(K_TOKEN, chatToken || "");
  set(K_IM_TOKEN, imToken || chatToken || "");
  set(K_USER_ID, userID || "");
};

export const clearAuth = () => {
  remove(K_TOKEN);
  remove(K_IM_TOKEN);
  remove(K_USER_ID);
  remove(K_PROFILE);
  // 退出/401 时必须清页面缓存，否则换账号会看到上一个人的数据
  clearPageCache();
};

export const getProfileCache = () => get(K_PROFILE, null);
export const setProfileCache = (profile) => set(K_PROFILE, profile);

export const hasAuth = () => Boolean(getToken());
