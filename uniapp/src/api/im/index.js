/**
 * IM 适配层入口 —— 页面只 import 这里，不直接碰 SDK。
 *
 * 平台实现：
 *   H5 / 浏览器 → ./h5.js  @openim/client-sdk（与 PC 的 WASM SDK 同一套服务端）
 *   App（Android/iOS） → ./app.js unix-openim-sdk UTS 原生插件
 *
 * 本文件负责：连接状态机、断线/网络切换重连、发送超时、事件广播、
 * 好友/群能力代理。页面不直接调 SDK。
 */
// #ifdef APP-PLUS
import * as impl from "./app";
// #endif
// #ifndef APP-PLUS
import * as impl from "./h5";
// #endif
import { clearAuth, getToken } from "@/utils/storage";

const SEND_TIMEOUT = 15000;
const CONNECT_TIMEOUT = 12000;

let state = "idle";
let connectPromise = null;
let reconnectPromise = null;
let networkBound = false;
let lastHealthAt = 0;
const listeners = {
  state: new Set(),
  message: new Set(),
  conversation: new Set(),
  unread: new Set(),
  application: new Set(),
  auth: new Set(),
  sync: new Set(),
};

function emit(event, payload, extra) {
  const set = listeners[event];
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(payload, extra);
    } catch (e) {
      console.error("[im] listener error", e);
    }
  });
}

export function on(event, handler) {
  if (!listeners[event]) listeners[event] = new Set();
  listeners[event].add(handler);
  return () => listeners[event].delete(handler);
}

export const getState = () => state;

function sink() {
  return {
    state: (s, detail) => {
      state = s;
      emit("state", s, detail);
      if (s === "kicked" || s === "expired") {
        connectPromise = null;
        reconnectPromise = null;
        clearAuth();
        emit("auth", { type: s });
      }
    },
    message: (payload) => emit("message", payload),
    conversation: (payload) => emit("conversation", payload),
    unread: (n) => emit("unread", n),
    application: (payload) => emit("application", payload),
    sync: () => emit("sync"),
  };
}

function bindNetwork() {
  if (networkBound || typeof uni.onNetworkStatusChange !== "function") return;
  networkBound = true;
  try {
    uni.onNetworkStatusChange((res) => {
      if (!res.isConnected) {
        if (state === "connected") {
          state = "offline";
          emit("state", state);
        }
        return;
      }
      if (getToken() && (state === "offline" || state === "failed")) {
        void reconnect().catch(() => {});
      }
    });
  } catch (e) {
    /* 某些平台没有网络事件，忽略 */
  }
  // #ifdef H5
  try {
    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("offline", () => {
        if (state === "connected") {
          state = "offline";
          emit("state", state);
        }
      });
      window.addEventListener("online", () => {
        if (getToken() && (state === "offline" || state === "failed")) {
          void reconnect().catch(() => {});
        }
      });
    }
  } catch (e) {
    /* ignore */
  }
  // #endif
}

export async function connect() {
  if (state === "connected") {
    // 不在每次进页面时做 getLoginStatus 健康检查：
    // App 冷启动时 login 已返回但同步/WS 还在 Logging，getLoginStatus 会短暂返回
    // 非 3；这里若判 failed，APP 的 loggedIn 仍为 true，后续 connect 直接 return，
    // 页面就一直空列表，必须退出重登才恢复。
    // 连接健康统一交给 ensureConnection（App onShow）和发送超时重连。
    return;
  }
  if (connectPromise) return connectPromise;
  bindNetwork();

  state = "connecting";
  emit("state", state);
  impl.setEventSink(sink());
  connectPromise = withTimeout(impl.connect(), CONNECT_TIMEOUT, "IM 连接超时，请检查网络/VPN", "CONNECT_TIMEOUT")
    .then(() => {
      // SDK 的 login/同步可能成功，但 WS 实际连接失败（OnConnectFailed）；
      // 不能无条件覆盖成 connected，否则页面以为能发消息。
      if (state === "failed" || state === "offline" || state === "kicked" || state === "expired") {
        const e = new Error(state === "kicked" ? "账号已在其他设备登录" : state === "expired" ? "登录已失效，请重新登录" : "IM 连接失败，请检查网络/VPN");
        e.code = state.toUpperCase();
        throw e;
      }
      state = "connected";
      emit("state", state);
    })
    .catch((e) => {
      state = "failed";
      emit("state", state, e);
      throw e;
    })
    .finally(() => {
      connectPromise = null;
    });
  return connectPromise;
}

export async function reconnect() {
  if (reconnectPromise) return reconnectPromise;
  if (!getToken()) throw new Error("登录已失效，请重新登录");
  bindNetwork();

  state = "connecting";
  emit("state", state);
  impl.setEventSink(sink());
  reconnectPromise = withTimeout(impl.reconnect(), CONNECT_TIMEOUT, "IM 重连超时，请检查网络/VPN", "CONNECT_TIMEOUT")
    .then(() => {
      // SDK 的 login/同步可能成功，但 WS 实际连接失败（OnConnectFailed）；
      // 不能无条件覆盖成 connected，否则页面以为能发消息。
      if (state === "failed" || state === "offline" || state === "kicked" || state === "expired") {
        const e = new Error(state === "kicked" ? "账号已在其他设备登录" : state === "expired" ? "登录已失效，请重新登录" : "IM 连接失败，请检查网络/VPN");
        e.code = state.toUpperCase();
        throw e;
      }
      state = "connected";
      emit("state", state);
    })
    .catch((e) => {
      state = "failed";
      emit("state", state, e);
      throw e;
    })
    .finally(() => {
      reconnectPromise = null;
    });
  return reconnectPromise;
}

/** 前后台/网络恢复时调用：只有确实没连上才重连，避免反复打断 */
export async function ensureConnection() {
  if (!getToken()) return;
  bindNetwork();
  if (state === "connected") {
    if (typeof impl.isAlive !== "function") return;
    const alive = await impl.isAlive().catch(() => false);
    if (alive) return;
    state = "failed";
    emit("state", state);
  }
  if (state === "connecting") return connectPromise;
  if (state === "offline" || state === "failed") return reconnect();
  return connect();
}

export function disconnect() {
  state = "idle";
  emit("state", state);
  connectPromise = null;
  reconnectPromise = null;
  try {
    impl.disconnect();
  } catch (e) {
    /* ignore */
  }
}

function withTimeout(promise, ms, message = "操作超时，请检查网络后重试", code = "TIMEOUT") {
  let timer = null;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const e = new Error(message);
      e.code = code;
      reject(e);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * 发送文本：
 *   - onPending 在 SDK 创建好消息、真正发送前回调，页面用它先上屏并落 outbox；
 *   - 15 秒没有回执就超时；超时会触发一次后台重连，页面把气泡标失败。
 */
export async function sendTextMessage(conversationID, text, { onPending } = {}) {
  if (state !== "connected") {
    const e = new Error("IM 未连接");
    e.code = "IM_OFFLINE";
    throw e;
  }
  const pending = await impl.createTextMessage(text);
  if (onPending) {
    try {
      onPending(pending);
    } catch (e) {
      console.error("[im] onPending error", e);
    }
  }
  let sent;
  try {
    sent = await withTimeout(impl.sendPreparedMessage(conversationID, pending), SEND_TIMEOUT, "发送超时，请检查网络后重试", "SEND_TIMEOUT");
  } catch (e) {
    if (e && e.code === "SEND_TIMEOUT") {
      // 连接可能已经半死；后台重连，页面表现为发送失败
      void reconnect().catch(() => {});
    }
    throw e;
  }
  emit("message", { conversationID, message: sent });
  return sent;
}

export async function listConversations() {
  if (state !== "connected") await connect();
  return impl.listConversations();
}

export async function getConversation(conversationID) {
  if (state !== "connected") await connect();
  return impl.getConversation(conversationID);
}

export async function getMessages(conversationID, options) {
  if (state !== "connected") await connect();
  return impl.getMessages(conversationID, options);
}

export async function markConversationRead(conversationID) {
  if (state !== "connected") return;
  try {
    return await impl.markConversationRead(conversationID);
  } catch (e) {
    /* 已读上报失败不阻塞聊天 */
  }
}

export async function totalUnread() {
  if (state !== "connected") await connect();
  return impl.totalUnread();
}

export async function listFriends() {
  if (state !== "connected") await connect();
  return impl.listFriends();
}

export async function listGroups() {
  if (state !== "connected") await connect();
  return impl.listGroups();
}

export async function getOrCreateConversation({ sourceID, sessionType }) {
  if (state !== "connected") await connect();
  return impl.getOrCreateConversation({ sourceID, sessionType });
}

/* ---------------- 好友 ---------------- */

export async function getFriendApplications(type = "received") {
  if (state !== "connected") await connect();
  return impl.getFriendApplications(type);
}

export async function handleFriendApplication(params) {
  if (state !== "connected") await connect();
  return impl.handleFriendApplication(params);
}

export async function addFriend(params) {
  if (state !== "connected") await connect();
  return impl.addFriend(params);
}

export async function deleteFriend(userID) {
  if (state !== "connected") await connect();
  return impl.deleteFriend(userID);
}

export async function updateFriendRemark(params) {
  if (state !== "connected") await connect();
  return impl.updateFriendRemark(params);
}

export async function getUsersInfo(userIDs) {
  if (state !== "connected") await connect();
  return impl.getUsersInfo(userIDs);
}

export async function getSpecifiedFriendsInfo(userIDs) {
  if (state !== "connected") await connect();
  return impl.getSpecifiedFriendsInfo(userIDs);
}

/** 联系人页红点：收到但未处理的好友/群申请数 */
export async function getApplicationUnhandled() {
  const [friends, groups] = await Promise.all([
    getFriendApplications("received").catch(() => []),
    getGroupApplications("received").catch(() => []),
  ]);
  return {
    friend: friends.filter((a) => a.handleResult === 0).length,
    group: groups.filter((a) => a.handleResult === 0).length,
  };
}

/* ---------------- 群 ---------------- */

export async function getGroupApplications(type = "received") {
  if (state !== "connected") await connect();
  return impl.getGroupApplications(type);
}

export async function handleGroupApplication(params) {
  if (state !== "connected") await connect();
  return impl.handleGroupApplication(params);
}

export async function getGroupInfo(groupID) {
  if (state !== "connected") await connect();
  return impl.getGroupInfo(groupID);
}

export async function getGroupMembers(groupID, options) {
  if (state !== "connected") await connect();
  return impl.getGroupMembers(groupID, options);
}

export async function createGroup(params) {
  if (state !== "connected") await connect();
  return impl.createGroup(params);
}

export async function joinGroup(params) {
  if (state !== "connected") await connect();
  return impl.joinGroup(params);
}

export async function inviteGroupMembers(params) {
  if (state !== "connected") await connect();
  return impl.inviteGroupMembers(params);
}

export async function kickGroupMember(params) {
  if (state !== "connected") await connect();
  return impl.kickGroupMember(params);
}

export async function quitGroup(groupID) {
  if (state !== "connected") await connect();
  return impl.quitGroup(groupID);
}

export async function dismissGroup(groupID) {
  if (state !== "connected") await connect();
  return impl.dismissGroup(groupID);
}

export async function transferGroupOwner(params) {
  if (state !== "connected") await connect();
  return impl.transferGroupOwner(params);
}

export async function setGroupInfo(params) {
  if (state !== "connected") await connect();
  return impl.setGroupInfo(params);
}

export default {
  connect,
  reconnect,
  ensureConnection,
  disconnect,
  getState,
  on,
  sendTextMessage,
  listConversations,
  getConversation,
  getMessages,
  markConversationRead,
  totalUnread,
  listFriends,
  listGroups,
  getOrCreateConversation,
  getFriendApplications,
  handleFriendApplication,
  addFriend,
  deleteFriend,
  updateFriendRemark,
  getUsersInfo,
  getSpecifiedFriendsInfo,
  getApplicationUnhandled,
  getGroupApplications,
  handleGroupApplication,
  getGroupInfo,
  getGroupMembers,
  createGroup,
  joinGroup,
  inviteGroupMembers,
  kickGroupMember,
  quitGroup,
  dismissGroup,
  transferGroupOwner,
  setGroupInfo,
};
