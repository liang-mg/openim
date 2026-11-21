/**
 * IM「后端接口」实现（imMode = api）。
 *
 * 为什么有这个模式：真实 OpenIM 还没部署时，消息模块不能只能看假数据。
 * OA 后端已经有站内通知接口（/notifications/list、/notifications/read），
 * 这部分是**真实数据**，先接进来：消息列表 = 系统通知，未读角标 = 未读通知数。
 *
 * 边界（必须说清楚，不许含糊）：
 *   - 这里只有「系统通知」，没有人与人聊天；发消息会明确报错，不假装成功；
 *   - 联系人列表在该模式下为空（后端没有对外的通讯录接口）；
 *   - 要真正的会话/群聊/已读回执，仍需 imMode = sdk（OpenIM）。
 *
 * 切换方式：运行时配置 imMode，或「我」页长按版本号里选「后端接口」。
 */
import { get, post } from "@/utils/request";

const NOTICE_CONV_ID = "notice";

/** 通知类型 → 图标/标签，保证列表可读 */
const KIND_TEXT = { leave: "请假", makeup: "补卡", exception: "考勤异常", report: "日报", urge: "催交", system: "系统" };

function toMessage(n, i) {
  return {
    clientMsgID: `notice_${n.id || n.notification_id || i}`,
    serverMsgID: String(n.id || n.notification_id || i),
    sendTime: n.created_at || n.createdAt || Date.now(),
    contentType: 101,
    content: { text: n.content || n.title || "" },
    senderNickname: KIND_TEXT[n.kind] || "系统通知",
    isSelf: false,
    read: Boolean(n.read),
  };
}

export async function connect() {
  // 后端接口模式没有长连接；这里只做一次可用性探测，失败就让页面显示错误
  await get("/me");
}

export function disconnect() {}

export async function listConversations() {
  const data = await get("/notifications/list", { page: 1, page_size: 30 });
  const list = data.list || data.notifications || [];
  const unread = list.filter((n) => !n.read).length;
  return [
    {
      conversationID: NOTICE_CONV_ID,
      showName: "系统通知",
      faceURL: "",
      unreadCount: unread,
      lastMessage: list.length ? toMessage(list[0], 0).content.text : "",
      lastTime: list.length ? toMessage(list[0], 0).sendTime : 0,
      isGroup: false,
    },
  ];
}

export async function getConversation(conversationID) {
  const list = await listConversations();
  return list.find((c) => c.conversationID === conversationID) || null;
}

export async function getMessages(conversationID, { before = 0, limit = 20 } = {}) {
  if (conversationID !== NOTICE_CONV_ID) return { list: [], hasMore: false };
  const data = await get("/notifications/list", { page: 1, page_size: 50 });
  const rows = (data.list || []).map(toMessage).sort((a, b) => a.sendTime - b.sendTime);
  const sliced = before ? rows.filter((m) => m.sendTime < before) : rows;
  return { list: sliced.slice(-limit), hasMore: sliced.length > limit };
}

export async function sendTextMessage() {
  throw new Error("当前是「后端通知」模式，只能看系统通知，发消息需要 OpenIM（imMode=sdk）");
}

export async function markConversationRead(conversationID) {
  if (conversationID !== NOTICE_CONV_ID) return;
  await post("/notifications/read", {});
}

export async function totalUnread() {
  const data = await get("/notifications/list", { page: 1, page_size: 50 });
  return (data.list || []).filter((n) => !n.read).length;
}

/** 该模式没有通讯录能力：返回空数组，页面显示"暂无"，而不是编数据 */
export async function listFriends() {
  return [];
}

export async function listGroups() {
  return [];
}

export default {
  connect,
  disconnect,
  listConversations,
  getConversation,
  getMessages,
  sendTextMessage,
  markConversationRead,
  totalUnread,
  listFriends,
  listGroups,
};
