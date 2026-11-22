/**
 * OpenIM 真实数据 → uni 页面使用的轻量结构。
 *
 * H5（@openim/client-sdk）与 App（unix-openim-sdk UTS 插件）返回的实体字段
 * 基本一致，差异只在「响应包装」：
 *   - JS SDK：多数方法返回 { errCode, errMsg, data }
 *   - UTS 插件：直接返回业务对象
 * 所以统一先 unwrap() 再映射。
 */

export function unwrap(res) {
  if (res && typeof res === "object" && "data" in res && ("errCode" in res || "code" in res)) {
    return res.data;
  }
  return res;
}

export function parseJSON(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    return null;
  }
}

export function extractText(msg) {
  if (!msg) return "";
  const elem = msg.textElem || (msg.content && msg.content.textElem);
  if (elem && typeof elem.content === "string") return elem.content;
  const parsed = parseJSON(msg.content);
  if (parsed && typeof parsed.content === "string") return parsed.content;
  if (typeof msg.content === "string") return msg.content;
  return "";
}

export function mapMessage(msg, selfID) {
  if (!msg) return null;
  const rawText = extractText(msg);
  const text = rawText || describeMessage(msg);
  const sendTime = Number(msg.sendTime || msg.createTime || Date.now());
  return {
    clientMsgID: msg.clientMsgID || `srv_${msg.serverMsgID || msg.seq || sendTime}`,
    serverMsgID: msg.serverMsgID || "",
    sendTime,
    contentType: msg.contentType,
    content: { text },
    text,
    placeholder: !rawText,
    system: isSystemMessage(msg),
    senderNickname: msg.senderNickname || "",
    senderName: msg.senderNickname || "",
    isSelf: Boolean(selfID && msg.sendID === selfID),
    read: Boolean(msg.isRead),
    status: "sent",
    sendID: msg.sendID || "",
    recvID: msg.recvID || "",
    groupID: msg.groupID || "",
    seq: msg.seq || 0,
  };
}

export function mapFriend(f) {
  if (!f) return null;
  return {
    userID: f.userID,
    nickname: f.nickname || f.userID,
    faceURL: f.faceURL || "",
    remark: f.remark || "",
    online: false,
  };
}

export function mapGroup(g) {
  if (!g) return null;
  return {
    groupID: g.groupID,
    groupName: g.groupName || g.groupID,
    name: g.groupName || g.groupID,
    faceURL: g.faceURL || "",
    memberCount: Number(g.memberCount || 0),
    ownerUserID: g.ownerUserID || "",
    notification: g.notification || "",
    introduction: g.introduction || "",
    groupType: Number(g.groupType || 0),
    status: Number(g.status || 0),
    createTime: Number(g.createTime || 0),
  };
}

/** 会话里的 latestMsg 是 JSON 字符串；统一成页面认识的 lastMessage */
export function mapConversation(c) {
  if (!c) return null;
  const latest = parseJSON(c.latestMsg);
  const lm = latest ? mapMessage(latest, "") : null;
  if (lm) {
    lm.sendTime = lm.sendTime || Number(c.latestMsgSendTime || 0);
    lm.content = { text: lm.text };
  }
  return {
    conversationID: c.conversationID,
    showName: c.showName || (lm && lm.senderNickname) || c.conversationID,
    faceURL: c.faceURL || "",
    isGroup: Boolean(c.groupID) || Number(c.conversationType) === 3,
    unreadCount: Number(c.unreadCount || 0),
    lastMessage: lm || { text: "", sendTime: Number(c.latestMsgSendTime || 0) },
    lastTime: Number((lm && lm.sendTime) || c.latestMsgSendTime || 0),
    raw: c,
  };
}

/** 由消息反推会话 ID（群聊 sg_，单聊 si_ 按 userID 字典序） */
export function conversationIDOfMessage(msg) {
  if (!msg) return "";
  if (msg.groupID) return `sg_${msg.groupID}`;
  const a = String(msg.sendID || "");
  const b = String(msg.recvID || "");
  if (!a || !b) return "";
  return `si_${[a, b].sort().join("_")}`;
}

/** 会话 ID → 发送目标 */
export function targetOfConversation(conversationID, selfID) {
  const id = String(conversationID || "");
  if (id.startsWith("sg_")) return { groupID: id.slice(3), recvID: "" };
  if (id.startsWith("si_")) {
    const parts = id.slice(3).split("_").filter(Boolean);
    const other = parts.find((x) => x !== String(selfID || "")) || parts[0] || "";
    return { recvID: other, groupID: "" };
  }
  // 兼容旧页面的 single_<userID>
  if (id.startsWith("single_")) return { recvID: id.slice(7), groupID: "" };
  return { recvID: "", groupID: "" };
}

/** 取消息数组：H5 事件是数组，App 插件事件是 { messageList } */
function eventData(payload) {
  const data = unwrap(payload);
  // 某些原生桥接/旧插件会把事件 payload 序列化成 JSON 字符串，先解一次
  if (typeof data === "string") return parseJSON(data) || data;
  return data;
}

export function messagesOfEvent(payload) {
  if (!payload) return [];
  const data = eventData(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.messageList)) return data.messageList;
  // App 端插件事件是 { messages: [...] }（Common/native-call-common.uts 的 OpenIMMessageListResult）
  if (Array.isArray(data && data.messages)) return data.messages;
  if (data && data.clientMsgID) return [data];
  return [];
}

export function conversationsOfEvent(payload) {
  if (!payload) return [];
  const data = eventData(payload);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data && data.conversations)) return data.conversations;
  return [];
}

/** 非文本消息的占位文案；至少让用户知道收到的是什么 */
export function describeMessage(msg) {
  const text = extractText(msg);
  if (text) return text;
  switch (Number(msg && msg.contentType)) {
    case 103:
      return "[图片]";
    case 104:
      return "[语音]";
    case 105:
      return "[视频]";
    case 106:
      return "[文件]";
    case 108:
      return "[合并消息]";
    case 109:
      return "[名片]";
    case 110:
      return "[位置]";
    case 113:
      return "[自定义消息]";
    case 114:
      return "[引用消息]";
    case 115:
      return "[表情]";
    case 1501:
      return "[群通知]";
    case 1502:
      return "[群通知]";
    case 1701:
      return "[好友申请]";
    case 1702:
      return "[好友申请通过]";
    case 1703:
      return "[好友申请被拒]";
    default:
      return "[消息]";
  }
}

export function isSystemMessage(msg) {
  const t = Number(msg && msg.contentType);
  return t >= 1501 && t < 1600;
}

/** 好友申请：收到的 / 发出的统一结构 */
export function mapFriendApplication(a, selfID) {
  if (!a) return null;
  const incoming = String(a.toUserID || "") === String(selfID || "");
  const uid = incoming ? a.fromUserID : a.toUserID;
  const nickname = incoming ? a.fromNickname : a.toNickname;
  const faceURL = incoming ? a.fromFaceURL : a.toFaceURL;
  return {
    id: `${a.fromUserID || ""}_${a.toUserID || ""}_${a.createTime || 0}`,
    userID: uid || "",
    nickname: nickname || uid || "",
    faceURL: faceURL || "",
    fromUserID: a.fromUserID || "",
    toUserID: a.toUserID || "",
    reqMsg: a.reqMsg || "",
    handleResult: Number(a.handleResult || 0),
    handleMsg: a.handleMsg || "",
    createTime: Number(a.createTime || 0),
    incoming,
    raw: a,
  };
}

/** 群申请：收到的 / 发出的统一结构 */
export function mapGroupApplication(a) {
  if (!a) return null;
  return {
    id: `${a.groupID || ""}_${a.userID || ""}_${a.reqTime || a.createTime || 0}`,
    groupID: a.groupID || "",
    groupName: a.groupName || "",
    userID: a.userID || "",
    nickname: a.nickname || a.userID || "",
    faceURL: a.userFaceURL || "",
    reqMsg: a.reqMsg || "",
    handleResult: Number(a.handleResult || 0),
    handleMsg: a.handledMsg || a.handleMsg || "",
    createTime: Number(a.reqTime || a.createTime || 0),
    joinSource: a.joinSource,
    inviterUserID: a.inviterUserID || "",
    raw: a,
  };
}

export function mapGroupMember(m) {
  if (!m) return null;
  return {
    groupID: m.groupID || "",
    userID: m.userID || "",
    nickname: m.nickname || m.userID || "",
    faceURL: m.faceURL || "",
    roleLevel: Number(m.roleLevel || 0),
    joinTime: Number(m.joinTime || 0),
    muteEndTime: Number(m.muteEndTime || 0),
    raw: m,
  };
}

export function mapUserInfo(u) {
  if (!u) return null;
  return {
    userID: u.userID || "",
    nickname: u.nickname || u.userID || "",
    faceURL: u.faceURL || "",
    phoneNumber: u.phoneNumber || "",
    raw: u,
  };
}
