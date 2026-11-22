/**
 * H5 / 浏览器端 OpenIM 实现：与 PC 端同源的 @openim/client-sdk（JS SDK）。
 *
 * 和 PC 的 wasm-client-sdk 连的是同一套 openim-server（/api + /msg_gateway），
 * 只是 H5 不落本地 SQLite，轻量、无需加载 35MB wasm。
 *
 * 只在 H5 构建里被引用；App 走 ./app.js 的 UTS 原生插件。
 */
import { getSDK, CbEvents } from "@openim/client-sdk";
import { CONFIG } from "@/config";
import { getIMToken, getUserId } from "@/utils/storage";
import {
  conversationIDOfMessage,
  conversationsOfEvent,
  mapConversation,
  mapFriend,
  mapFriendApplication,
  mapGroup,
  mapGroupApplication,
  mapGroupMember,
  mapMessage,
  mapUserInfo,
  messagesOfEvent,
  targetOfConversation,
  unwrap,
} from "./common";

let sdk = null;
let loggedIn = false;
let bound = false;
let sink = null;
let syncResolve = null;
let syncPromise = null;

function resetSync() {
  syncPromise = new Promise((resolve) => {
    syncResolve = resolve;
  });
}

export function setEventSink(next) {
  sink = next || null;
}

function getUser() {
  return { userID: getUserId(), token: getIMToken() };
}

function emitApp(type, action, data) {
  if (sink && data) sink.application({ type, action, data });
}

function bindEvents() {
  if (bound) return;
  bound = true;
  const client = sdk;

  client.on(CbEvents.OnConnectSuccess, () => sink && sink.state("connected"));
  client.on(CbEvents.OnConnecting, () => sink && sink.state("connecting"));
  client.on(CbEvents.OnConnectFailed, (e) => sink && sink.state("failed", e));
  client.on(CbEvents.OnKickedOffline, () => sink && sink.state("kicked"));
  client.on(CbEvents.OnUserTokenExpired, () => sink && sink.state("expired"));
  client.on(CbEvents.OnUserTokenInvalid, () => sink && sink.state("expired"));
  client.on(CbEvents.OnSyncServerFinish, () => {
    if (syncResolve) syncResolve();
    if (sink) sink.sync();
  });
  client.on(CbEvents.OnRecvNewMessages, (payload) => {
    const { userID } = getUser();
    messagesOfEvent(payload).forEach((raw) => {
      const message = mapMessage(raw, userID);
      if (message && sink) {
        sink.message({ conversationID: conversationIDOfMessage(raw), message });
      }
    });
  });
  client.on(CbEvents.OnNewConversation, (payload) => {
    conversationsOfEvent(payload).forEach((raw) => {
      if (sink) sink.conversation(mapConversation(raw));
    });
  });
  client.on(CbEvents.OnConversationChanged, (payload) => {
    conversationsOfEvent(payload).forEach((raw) => {
      if (sink) sink.conversation(mapConversation(raw));
    });
  });
  client.on(CbEvents.OnTotalUnreadMessageCountChanged, (payload) => {
    if (!sink) return;
    const n = unwrap(payload);
    sink.unread(Number(n || 0));
  });
  client.on(CbEvents.OnFriendApplicationAdded, (payload) => {
    emitApp("friend", "added", mapFriendApplication(unwrap(payload), getUser().userID));
  });
  client.on(CbEvents.OnFriendApplicationAccepted, (payload) => {
    emitApp("friend", "accepted", mapFriendApplication(unwrap(payload), getUser().userID));
  });
  client.on(CbEvents.OnFriendApplicationRejected, (payload) => {
    emitApp("friend", "rejected", mapFriendApplication(unwrap(payload), getUser().userID));
  });
  client.on(CbEvents.OnFriendApplicationDeleted, (payload) => {
    emitApp("friend", "deleted", mapFriendApplication(unwrap(payload), getUser().userID));
  });
  client.on(CbEvents.OnGroupApplicationAdded, (payload) => {
    emitApp("group", "added", mapGroupApplication(unwrap(payload)));
  });
  client.on(CbEvents.OnGroupApplicationAccepted, (payload) => {
    emitApp("group", "accepted", mapGroupApplication(unwrap(payload)));
  });
  client.on(CbEvents.OnGroupApplicationRejected, (payload) => {
    emitApp("group", "rejected", mapGroupApplication(unwrap(payload)));
  });
  client.on(CbEvents.OnGroupApplicationDeleted, (payload) => {
    emitApp("group", "deleted", mapGroupApplication(unwrap(payload)));
  });
}

export async function connect() {
  if (loggedIn) return;
  const { userID, token } = getUser();
  if (!userID || !token) throw new Error("缺少 IM 登录态，请重新登录");

  if (!sdk) sdk = getSDK();
  resetSync();
  bindEvents();

  const res = await sdk.login({
    userID,
    token,
    apiAddr: CONFIG.imApiBase,
    wsAddr: CONFIG.wsUrl,
    platformID: CONFIG.imPlatformID || 5,
    logLevel: 3,
  });
  if (res && res.errCode) throw new Error(res.errMsg || "IM 登录失败");
  loggedIn = true;

  await Promise.race([
    syncPromise,
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}

export async function reconnect() {
  // H5 的 SDK 发送队列是模块级的：离线时卡住的任务会把后续消息一起堵死，
  // 仅换 SDK 实例/logout 都无法清掉。最可靠的是整页刷新（保留当前 hash 路由，
  // token 与 outbox 都在 localStorage），刷新后由页面重新建立连接。
  // #ifdef H5
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const e = new Error("网络已断开");
    e.code = "OFFLINE";
    throw e;
  }
  if (typeof window !== "undefined" && navigator.onLine) {
    const KEY = "oa_im_hard_reload_at";
    let last = 0;
    try {
      last = Number(sessionStorage.getItem(KEY) || 0);
    } catch (e) {
      last = 0;
    }
    if (Date.now() - last > 10000) {
      try {
        sessionStorage.setItem(KEY, String(Date.now()));
      } catch (e) {
        /* ignore */
      }
      window.location.reload();
      return new Promise(() => {});
    }
  }
  // #endif
  // App/兜底：清任务并换一个干净的 SDK 实例
  if (!sdk) return connect();
  const old = sdk;
  try {
    if (typeof old.cancelMessageTasks === "function") old.cancelMessageTasks();
  } catch (e) {
    /* ignore */
  }
  try {
    old.logout().catch(() => {});
  } catch (e) {
    /* ignore */
  }
  sdk = getSDK();
  bound = false;
  loggedIn = false;
  return connect();
}

export async function isAlive() {
  if (!sdk || !loggedIn) return false;
  try {
    const res = await sdk.getLoginStatus();
    return unwrap(res) === 3;
  } catch (e) {
    return false;
  }
}

export async function disconnect() {
  loggedIn = false;
  try {
    if (sdk) await sdk.logout();
  } catch (e) {
    /* ignore */
  }
}

export async function createTextMessage(text) {
  const { userID } = getUser();
  const raw = unwrap(await sdk.createTextMessage(text));
  if (!raw) throw new Error("创建消息失败");
  const message = mapMessage(raw, userID);
  message.isSelf = true;
  message.status = "sending";
  message.sendTime = Date.now();
  message._raw = raw;
  return message;
}

export async function sendPreparedMessage(conversationID, prepared) {
  const { userID } = getUser();
  const raw = prepared && prepared._raw;
  if (!raw) throw new Error("消息未准备好，请重试");
  const target = targetOfConversation(conversationID, userID);
  if (!target.recvID && !target.groupID) throw new Error("无法识别会话目标");
  const res = await sdk.sendMessage({
    message: raw,
    recvID: target.recvID,
    groupID: target.groupID,
  });
  const sent = unwrap(res);
  if (!sent) throw new Error("发送失败");
  return mapMessage(sent, userID);
}

/** 兼容旧调用：内部自己创建再发送 */
export async function sendTextMessage(conversationID, text) {
  const pending = await createTextMessage(text);
  return sendPreparedMessage(conversationID, pending);
}

export async function listConversations() {
  const res = await sdk.getConversationListSplit({ offset: 0, count: 100 });
  const list = unwrap(res) || [];
  return list.map(mapConversation).filter(Boolean);
}

export async function getConversation(conversationID) {
  const list = await listConversations();
  return list.find((c) => c.conversationID === conversationID) || null;
}

export async function getMessages(conversationID, { beforeClientMsgID = "", limit = 20 } = {}) {
  const res = await sdk.getAdvancedHistoryMessageList({
    conversationID,
    startClientMsgID: beforeClientMsgID || "",
    count: limit,
  });
  const data = unwrap(res) || {};
  const { userID } = getUser();
  return {
    list: (data.messageList || [])
      .map((m) => mapMessage(m, userID))
      .filter(Boolean)
      .sort((a, b) => a.sendTime - b.sendTime),
    hasMore: !data.isEnd,
  };
}

export async function markConversationRead(conversationID) {
  try {
    await sdk.markConversationMessageAsRead(conversationID);
  } catch (e) {
    /* 已经全部已读时忽略 */
  }
}

export async function totalUnread() {
  const res = await sdk.getTotalUnreadMsgCount();
  return Number(unwrap(res) || 0);
}

export async function listFriends() {
  const res = await sdk.getFriendListPage({ offset: 0, count: 1000 });
  return (unwrap(res) || []).map(mapFriend).filter(Boolean);
}

export async function listGroups() {
  const res = await sdk.getJoinedGroupListPage({ offset: 0, count: 1000 });
  return (unwrap(res) || []).map(mapGroup).filter(Boolean);
}

export async function getOrCreateConversation({ sourceID, sessionType }) {
  const res = await sdk.getOneConversation({ sourceID, sessionType });
  return mapConversation(unwrap(res));
}

/* ---------------- 好友 ---------------- */

export async function getFriendApplications(type = "received") {
  const api =
    type === "sent"
      ? sdk.getFriendApplicationListAsApplicant
      : sdk.getFriendApplicationListAsRecipient;
  const res = await api({ offset: 0, count: 100 });
  const self = getUserId();
  return (unwrap(res) || []).map((a) => mapFriendApplication(a, self)).filter(Boolean);
}

export async function handleFriendApplication({ toUserID, accept, handleMsg = "" }) {
  const api = accept ? sdk.acceptFriendApplication : sdk.refuseFriendApplication;
  await api({ toUserID, handleMsg: handleMsg || (accept ? "同意" : "拒绝") });
}

export async function addFriend({ toUserID, reqMsg = "", ex = "" }) {
  await sdk.addFriend({ toUserID, reqMsg, ex });
}

export async function deleteFriend(userID) {
  await sdk.deleteFriend(userID);
}

export async function updateFriendRemark({ userID, remark }) {
  await sdk.updateFriends({ friendUserIDs: [userID], remark });
}

export async function getUsersInfo(userIDs) {
  const res = await sdk.getUsersInfo(userIDs);
  return (unwrap(res) || []).map(mapUserInfo).filter(Boolean);
}

export async function getSpecifiedFriendsInfo(userIDs) {
  const res = await sdk.getSpecifiedFriendsInfo(userIDs);
  return (unwrap(res) || []).map(mapUserInfo).filter(Boolean);
}

/* ---------------- 群 ---------------- */

export async function getGroupApplications(type = "received") {
  const api =
    type === "sent"
      ? sdk.getGroupApplicationListAsApplicant
      : sdk.getGroupApplicationListAsRecipient;
  const res = await api({ offset: 0, count: 100 });
  return (unwrap(res) || []).map(mapGroupApplication).filter(Boolean);
}

export async function handleGroupApplication({ groupID, fromUserID, accept, handleMsg = "" }) {
  const api = accept ? sdk.acceptGroupApplication : sdk.refuseGroupApplication;
  await api({ groupID, fromUserID, handleMsg: handleMsg || (accept ? "同意" : "拒绝") });
}

export async function getGroupInfo(groupID) {
  const res = await sdk.getSpecifiedGroupsInfo([groupID]);
  return mapGroup((unwrap(res) || [])[0]);
}

export async function getGroupMembers(groupID, { offset = 0, count = 100 } = {}) {
  const res = await sdk.getGroupMemberList({ groupID, filter: 0, offset, count });
  return (unwrap(res) || []).map(mapGroupMember).filter(Boolean);
}

export async function createGroup({ groupName, memberUserIDs, notification = "" }) {
  const res = await sdk.createGroup({
    memberUserIDs,
    groupInfo: { groupName, groupType: 2, notification },
  });
  return mapGroup(unwrap(res));
}

export async function joinGroup({ groupID, reqMsg = "" }) {
  await sdk.joinGroup({ groupID, reqMsg, joinSource: 3 });
}

export async function inviteGroupMembers({ groupID, userIDs }) {
  await sdk.inviteUserToGroup({ groupID, reason: "", userIDList: userIDs });
}

export async function kickGroupMember({ groupID, userID }) {
  await sdk.kickGroupMember({ groupID, reason: "", userIDList: [userID] });
}

export async function quitGroup(groupID) {
  await sdk.quitGroup(groupID);
}

export async function dismissGroup(groupID) {
  await sdk.dismissGroup(groupID);
}

export async function transferGroupOwner({ groupID, userID }) {
  await sdk.transferGroupOwner({ groupID, newOwnerUserID: userID });
}

export async function setGroupInfo({ groupID, groupName, notification, introduction, faceURL }) {
  const params = { groupID };
  if (groupName != null) params.groupName = groupName;
  if (notification != null) params.notification = notification;
  if (introduction != null) params.introduction = introduction;
  if (faceURL != null) params.faceURL = faceURL;
  await sdk.setGroupInfo(params);
}

export default {
  connect,
  reconnect,
  disconnect,
  isAlive,
  setEventSink,
  createTextMessage,
  sendPreparedMessage,
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
