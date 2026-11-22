/**
 * App（Android / iOS）端 OpenIM 实现：官方 unix-openim-sdk UTS 原生插件。
 *
 * 插件目录：src/uni_modules/unix-openim-sdk
 * 原生依赖：Android io.openim:core-sdk / iOS OpenIMSDKCore（插件 config.json 已声明）
 * 注意：必须用自定义基座或正式包验证；标准基座没有原生 SDK。
 *
 * 只在 App 构建里被引用；H5 走 ./h5.js 的 JS SDK。
 */
import {
  initSDK,
  login,
  logout,
  getLoginStatus,
  onConnectSuccess,
  onConnectFailed,
  onConnecting,
  onKickedOffline,
  onUserTokenExpired,
  onUserTokenInvalid,
  onSyncServerFinish,
  onRecvNewMessages,
  onNewConversation,
  onConversationChanged,
  onTotalUnreadMessageCountChanged,
  onFriendApplicationAdded,
  onFriendApplicationAccepted,
  onFriendApplicationRejected,
  onFriendApplicationDeleted,
  onGroupApplicationAdded,
  onGroupApplicationAccepted,
  onGroupApplicationRejected,
  onGroupApplicationDeleted,
  getConversationListSplit,
  getAdvancedHistoryMessageList,
  sendMessage,
  sendMessageNotOss,
  markConversationMessageAsRead,
  getTotalUnreadMsgCount,
  getFriendListPage,
  getJoinedGroupListPage,
  getOneConversation,
  getFriendApplicationListAsRecipient,
  getFriendApplicationListAsApplicant,
  acceptFriendApplication,
  refuseFriendApplication,
  addFriend as addFriendSdk,
  deleteFriend as deleteFriendSdk,
  updateFriends,
  getUsersInfo as getUsersInfoSdk,
  getSpecifiedFriendsInfo as getSpecifiedFriendsInfoSdk,
  getGroupApplicationListAsRecipient,
  getGroupApplicationListAsApplicant,
  acceptGroupApplication,
  refuseGroupApplication,
  getSpecifiedGroupsInfo,
  getGroupMemberList,
  createGroup as createGroupSdk,
  joinGroup as joinGroupSdk,
  inviteUserToGroup,
  kickGroupMember as kickGroupMemberSdk,
  quitGroup as quitGroupSdk,
  dismissGroup as dismissGroupSdk,
  transferGroupOwner as transferGroupOwnerSdk,
  setGroupInfo as setGroupInfoSdk,
} from "@/uni_modules/unix-openim-sdk";
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

let inited = false;
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

function assertAbsolute(base, label, pattern = /^https?:\/\//i) {
  if (!pattern.test(String(base || ""))) {
    throw new Error(
      `${label}必须是绝对地址（当前为 ${base || "空"}）。APK 请在 .env.production 配置 VITE_APP_ORIGIN=https://im.9ty.lol，或在「我」页长按版本号填写线上/局域网地址。`
    );
  }
}

const eventSubscriptions = [];

function keep(subscription) {
  if (subscription) eventSubscriptions.push(subscription);
  return subscription;
}

function bindEvents() {
  if (bound) return;
  bound = true;

  keep(onConnectSuccess(() => sink && sink.state("connected")));
  keep(onConnecting(() => sink && sink.state("connecting")));
  keep(onConnectFailed(() => sink && sink.state("failed")));
  keep(onKickedOffline(() => sink && sink.state("kicked")));
  keep(onUserTokenExpired(() => sink && sink.state("expired")));
  keep(onUserTokenInvalid(() => sink && sink.state("expired")));
  keep(onSyncServerFinish(() => {
    if (syncResolve) syncResolve();
    if (sink) sink.sync();
  }));
  keep(onRecvNewMessages((payload) => {
    const { userID } = getUser();
    messagesOfEvent(payload).forEach((raw) => {
      const message = mapMessage(raw, userID);
      if (message && sink) {
        sink.message({ conversationID: conversationIDOfMessage(raw), message });
      }
    });
  }));
  keep(onNewConversation((payload) => {
    conversationsOfEvent(payload).forEach((raw) => {
      if (sink) sink.conversation(mapConversation(raw));
    });
  }));
  keep(onConversationChanged((payload) => {
    conversationsOfEvent(payload).forEach((raw) => {
      if (sink) sink.conversation(mapConversation(raw));
    });
  }));
  keep(onTotalUnreadMessageCountChanged((payload) => {
    if (!sink) return;
    sink.unread(Number(unwrap(payload) || 0));
  }));
  keep(onFriendApplicationAdded((a) => {
    emitApp("friend", "added", mapFriendApplication(unwrap(a), getUser().userID));
  }));
  keep(onFriendApplicationAccepted((a) => {
    emitApp("friend", "accepted", mapFriendApplication(unwrap(a), getUser().userID));
  }));
  keep(onFriendApplicationRejected((a) => {
    emitApp("friend", "rejected", mapFriendApplication(unwrap(a), getUser().userID));
  }));
  keep(onFriendApplicationDeleted((a) => {
    emitApp("friend", "deleted", mapFriendApplication(unwrap(a), getUser().userID));
  }));
  keep(onGroupApplicationAdded((a) => {
    emitApp("group", "added", mapGroupApplication(unwrap(a)));
  }));
  keep(onGroupApplicationAccepted((a) => {
    emitApp("group", "accepted", mapGroupApplication(unwrap(a)));
  }));
  keep(onGroupApplicationRejected((a) => {
    emitApp("group", "rejected", mapGroupApplication(unwrap(a)));
  }));
  keep(onGroupApplicationDeleted((a) => {
    emitApp("group", "deleted", mapGroupApplication(unwrap(a)));
  }));
}

export async function connect() {
  if (loggedIn) return;
  const { userID, token } = getUser();
  if (!userID || !token) throw new Error("缺少 IM 登录态，请重新登录");
  assertAbsolute(CONFIG.imApiBase, "IM API 地址");
  assertAbsolute(CONFIG.wsUrl, "IM WebSocket 地址", /^wss?:\/\//i);

  if (!inited) {
    const systemType = CONFIG.imPlatformID === 1 ? "ios" : "android";
    await initSDK({
      platformID: CONFIG.imPlatformID === 1 ? 1 : 2,
      apiAddr: CONFIG.imApiBase,
      wsAddr: CONFIG.wsUrl,
      dataDir: "",
      logLevel: 5,
      isLogStandardOutput: false,
      systemType,
    });
    inited = true;
  }

  resetSync();
  bindEvents();
  await login(userID, token);
  loggedIn = true;

  await Promise.race([
    syncPromise,
    new Promise((resolve) => setTimeout(resolve, 8000)),
  ]);
}

export async function reconnect() {
  if (!inited) return connect();
  try {
    await logout();
  } catch (e) {
    /* ignore */
  }
  loggedIn = false;
  return connect();
}

export async function isAlive() {
  if (!inited || !loggedIn) return false;
  try {
    return (await getLoginStatus()) === 3;
  } catch (e) {
    return false;
  }
}

export async function disconnect() {
  loggedIn = false;
  try {
    if (inited) await logout();
  } catch (e) {
    /* ignore */
  }
}

export async function createTextMessage(text) {
  const { userID } = getUser();
  if (!userID) throw new Error("缺少 IM 用户ID，请重新登录");
  const now = Date.now();
  const clientMsgID = `app_${now}_${Math.random().toString(36).slice(2, 10)}`;
  // 不走插件的 createTextMessage：它返回的 JSON 要经过 UTS 解析器，
  // 少一个字段（sendTime/senderPlatformID 等）就会返回 null，表现为
  // “创建消息失败 / 一直发不出去”。文本消息结构是固定的，直接按
  // OpenIMMessageItem 的完整字段构造，交给原生 sendMessage。
  const raw = {
    clientMsgID,
    serverMsgID: "",
    createTime: now,
    sendTime: 0,
    sessionType: 1,
    sendID: userID,
    recvID: "",
    groupID: "",
    msgFrom: 100,
    contentType: 101,
    senderPlatformID: CONFIG.imPlatformID || 2,
    senderNickname: "",
    senderFaceUrl: "",
    content: JSON.stringify({ content: text }),
    seq: 0,
    isRead: false,
    status: 1,
    textElem: { content: text },
    attachedInfo: "",
    ex: "",
    localEx: "",
  };
  const message = mapMessage(raw, userID);
  message.isSelf = true;
  message.status = "sending";
  message.sendTime = now;
  message._raw = raw;
  return message;
}

// 避免和导出名冲突

export async function sendPreparedMessage(conversationID, prepared) {
  const { userID } = getUser();
  const raw = prepared && prepared._raw;
  if (!raw) throw new Error("消息未准备好，请重试");
  const target = targetOfConversation(conversationID, userID);
  if (!target.recvID && !target.groupID) throw new Error("无法识别会话目标");
  // 发送前把会话目标补全到消息体（create 阶段还不知道单聊/群聊）
  raw.sessionType = target.groupID ? 3 : 1;
  raw.recvID = target.recvID || "";
  raw.groupID = target.groupID || "";
  raw.sendID = userID;
  if (!raw.createTime) raw.createTime = Date.now();
  if (!raw.clientMsgID) raw.clientMsgID = `app_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  raw.status = 1;
  const sent = await sendMessage({
    operationID: `send_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    message: raw,
    recvID: target.recvID,
    groupID: target.groupID,
    isOnlineOnly: false,
  });
  if (!sent) throw new Error("发送失败");
  return mapMessage(sent, userID);
}

/** 兼容旧调用：内部自己创建再发送 */
export async function sendTextMessage(conversationID, text) {
  const pending = await createTextMessage(text);
  return sendPreparedMessage(conversationID, pending);
}

export async function listConversations() {
  const res = await getConversationListSplit({ offset: 0, count: 100 });
  const data = unwrap(res) || {};
  return (data.conversations || []).map(mapConversation).filter(Boolean);
}

export async function getConversation(conversationID) {
  const list = await listConversations();
  return list.find((c) => c.conversationID === conversationID) || null;
}

export async function getMessages(conversationID, { beforeClientMsgID = "", limit = 20 } = {}) {
  const res = await getAdvancedHistoryMessageList({
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
    await markConversationMessageAsRead(conversationID);
  } catch (e) {
    /* 已读状态重复上报时忽略 */
  }
}

export async function totalUnread() {
  const n = await getTotalUnreadMsgCount();
  return Number(unwrap(n) || 0);
}

export async function listFriends() {
  const res = await getFriendListPage({ offset: 0, count: 1000 });
  const data = unwrap(res) || {};
  return (data.friends || []).map(mapFriend).filter(Boolean);
}

export async function listGroups() {
  const res = await getJoinedGroupListPage({ offset: 0, count: 1000 });
  const data = unwrap(res) || {};
  return (data.groups || []).map(mapGroup).filter(Boolean);
}

export async function getOrCreateConversation({ sourceID, sessionType }) {
  const res = await getOneConversation({ sourceID, sessionType });
  return mapConversation(unwrap(res));
}

/* ---------------- 好友 ---------------- */

export async function getFriendApplications(type = "received") {
  const api =
    type === "sent"
      ? getFriendApplicationListAsApplicant
      : getFriendApplicationListAsRecipient;
  const res = await api({ offset: 0, count: 100 });
  const data = unwrap(res) || {};
  const self = getUserId();
  return (data.applications || []).map((a) => mapFriendApplication(a, self)).filter(Boolean);
}

export async function handleFriendApplication({ toUserID, accept, handleMsg = "" }) {
  const api = accept ? acceptFriendApplication : refuseFriendApplication;
  await api({ toUserID, handleMsg: handleMsg || (accept ? "同意" : "拒绝") });
}

export async function addFriend({ toUserID, reqMsg = "", ex = "" }) {
  await addFriendSdk({ toUserID, reqMsg, ex });
}


export async function deleteFriend(userID) {
  await deleteFriendSdk(userID);
}


export async function updateFriendRemark({ userID, remark }) {
  await updateFriends({ friendUserIDs: [userID], remark });
}

export async function getUsersInfo(userIDs) {
  const res = await getUsersInfoSdk(userIDs);
  const data = unwrap(res) || {};
  return (data.users || []).map(mapUserInfo).filter(Boolean);
}


export async function getSpecifiedFriendsInfo(userIDs) {
  const res = await getSpecifiedFriendsInfoSdk({ userIDList: userIDs });
  const data = unwrap(res) || {};
  return (data.friends || []).map(mapUserInfo).filter(Boolean);
}


/* ---------------- 群 ---------------- */

export async function getGroupApplications(type = "received") {
  const api =
    type === "sent"
      ? getGroupApplicationListAsApplicant
      : getGroupApplicationListAsRecipient;
  const res = await api({ offset: 0, count: 100 });
  const data = unwrap(res) || {};
  return (data.applications || []).map(mapGroupApplication).filter(Boolean);
}

export async function handleGroupApplication({ groupID, fromUserID, accept, handleMsg = "" }) {
  const api = accept ? acceptGroupApplication : refuseGroupApplication;
  await api({ groupID, fromUserID, handleMsg: handleMsg || (accept ? "同意" : "拒绝") });
}

export async function getGroupInfo(groupID) {
  const res = await getSpecifiedGroupsInfo([groupID]);
  const data = unwrap(res) || {};
  return mapGroup((data.groups || [])[0]);
}

export async function getGroupMembers(groupID, { offset = 0, count = 100 } = {}) {
  const res = await getGroupMemberList({ groupID, filter: 0, offset, count });
  const data = unwrap(res) || {};
  return (data.members || []).map(mapGroupMember).filter(Boolean);
}

export async function createGroup({ groupName, memberUserIDs, notification = "" }) {
  const group = await createGroupSdk({
    groupInfo: { groupName, groupType: 2, notification },
    memberUserIDs,
  });
  return mapGroup(unwrap(group));
}


export async function joinGroup({ groupID, reqMsg = "" }) {
  await joinGroupSdk({ groupID, reqMsg, joinSource: 3 });
}


export async function inviteGroupMembers({ groupID, userIDs }) {
  await inviteUserToGroup({ groupID, reason: "", userIDList: userIDs });
}

export async function kickGroupMember({ groupID, userID }) {
  await kickGroupMemberSdk({ groupID, reason: "", userIDList: [userID] });
}


export async function quitGroup(groupID) {
  await quitGroupSdk(groupID);
}


export async function dismissGroup(groupID) {
  await dismissGroupSdk(groupID);
}


export async function transferGroupOwner({ groupID, userID }) {
  await transferGroupOwnerSdk({ groupID, newOwnerUserID: userID });
}


export async function setGroupInfo({ groupID, groupName, notification, introduction, faceURL }) {
  const params = { groupID };
  if (groupName != null) params.groupName = groupName;
  if (notification != null) params.notification = notification;
  if (introduction != null) params.introduction = introduction;
  if (faceURL != null) params.faceURL = faceURL;
  await setGroupInfoSdk(params);
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
