/**
 * mock 实现：内存假数据，用于 IM 服务没起时把 UI 跑通。
 * 只实现数据操作，连接状态与事件由 ../im/index.js 统一管理。
 */

const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

const now = Date.now();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const CONVERSATIONS = [
  {
    conversationID: "single_9283941092",
    showName: "王强",
    faceURL: "",
    isGroup: false,
    unreadCount: 2,
    lastMessage: { text: "今天的日报记得提交，我这边等你", sendTime: now - 12 * MIN, senderName: "王强" },
  },
  {
    conversationID: "group_oa_dev",
    showName: "OA 项目组",
    faceURL: "",
    isGroup: true,
    memberCount: 6,
    unreadCount: 0,
    lastMessage: { text: "移动端审批中心已联调通过", sendTime: now - 2 * HOUR, senderName: "李然" },
  },
  {
    conversationID: "single_7474479331",
    showName: "张明",
    faceURL: "",
    isGroup: false,
    unreadCount: 1,
    lastMessage: { text: "补卡申请我提交了，麻烦王强看一下", sendTime: now - 5 * HOUR, senderName: "张明" },
  },
  {
    conversationID: "group_tech",
    showName: "技术部",
    faceURL: "",
    isGroup: true,
    memberCount: 6,
    unreadCount: 0,
    lastMessage: { text: "周五下午评审，提前把材料准备好", sendTime: now - DAY, senderName: "王经理" },
  },
];

function seedMessages() {
  const map = {};
  const build = (id, peer, peerName) => {
    const list = [];
    for (let i = 30; i >= 1; i -= 1) {
      const self = i % 3 !== 0;
      list.push({
        clientMsgID: `${id}_m${i}`,
        sendTime: now - i * 7 * MIN,
        isSelf: self,
        senderID: self ? "self" : peer,
        senderName: self ? "我" : peerName,
        text: self
          ? `第 ${i} 条：这是我自己发的消息，用来验证时间分组和滚动。`
          : `第 ${i} 条：${peerName} 发来的消息，验证对方气泡与发送者名。`,
        status: "sent",
      });
    }
    return list;
  };
  map["single_9283941092"] = build("single_9283941092", "9283941092", "王强");
  map["single_7474479331"] = build("single_7474479331", "7474479331", "张明");
  map["group_oa_dev"] = [
    { clientMsgID: "g1", sendTime: now - 3 * HOUR, isSelf: false, senderID: "7474479331", senderName: "张明", text: "移动端审批中心我这边点过了，同意流程没问题", status: "sent" },
    { clientMsgID: "g2", sendTime: now - 2.6 * HOUR, isSelf: false, senderID: "2158780278", senderName: "李然", text: "移动端审批中心已联调通过", status: "sent" },
    { clientMsgID: "g3", sendTime: now - 2 * HOUR, isSelf: true, senderID: "self", senderName: "我", text: "收到，我这边继续对报告查阅", status: "sent" },
  ];
  map["group_tech"] = [
    { clientMsgID: "t1", sendTime: now - DAY, isSelf: false, senderID: "7559659175", senderName: "王经理", text: "周五下午评审，提前把材料准备好", status: "sent" },
  ];
  return map;
}

const MESSAGES = seedMessages();

const FRIENDS = [
  { userID: "9283941092", nickname: "王强", department: "技术部", position: "技术组长", online: true },
  { userID: "7474479331", nickname: "张明", department: "技术部", position: "后端工程师", online: false },
  { userID: "7336036568", nickname: "陈晓", department: "技术部", position: "测试工程师", online: true },
  { userID: "2170228929", nickname: "刘洋", department: "技术部", position: "后端组长", online: false },
  { userID: "7559659175", nickname: "王经理", department: "技术部", position: "部门经理", online: true },
];

const GROUPS = [
  { groupID: "group_oa_dev", name: "OA 项目组", memberCount: 6 },
  { groupID: "group_tech", name: "技术部", memberCount: 6 },
  { groupID: "group_all", name: "新博 OA 全员群", memberCount: 28 },
];

export async function connect() {
  await delay(400);
}

export async function listConversations() {
  await delay(80);
  return CONVERSATIONS.slice()
    .sort((a, b) => b.lastMessage.sendTime - a.lastMessage.sendTime)
    .map((c) => ({ ...c }));
}

export async function getConversation(conversationID) {
  await delay(30);
  const hit = CONVERSATIONS.find((c) => c.conversationID === conversationID);
  return hit ? { ...hit } : null;
}

export async function getMessages(conversationID, { before, limit = 20 } = {}) {
  await delay(150);
  const all = MESSAGES[conversationID] || [];
  const filtered = before ? all.filter((m) => m.sendTime < before) : all;
  const page = filtered.slice(-limit);
  return { list: page.slice(), hasMore: filtered.length > page.length };
}

export async function sendTextMessage(conversationID, text) {
  const content = String(text || "").trim();
  if (!content) throw new Error("消息内容为空");
  const msg = {
    clientMsgID: `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    sendTime: Date.now(),
    isSelf: true,
    senderID: "self",
    senderName: "我",
    text: content,
    status: "sent",
  };
  if (!MESSAGES[conversationID]) MESSAGES[conversationID] = [];
  MESSAGES[conversationID].push(msg);
  const conv = CONVERSATIONS.find((c) => c.conversationID === conversationID);
  if (conv) {
    conv.lastMessage = { text: content, sendTime: msg.sendTime, senderName: "我" };
    conv.unreadCount = 0;
  }
  return { message: { ...msg }, conversation: conv ? { ...conv } : null };
}

export async function markConversationRead(conversationID) {
  const conv = CONVERSATIONS.find((c) => c.conversationID === conversationID);
  if (conv) conv.unreadCount = 0;
  return true;
}

export async function totalUnread() {
  await delay(20);
  return CONVERSATIONS.reduce((sum, c) => sum + (c.unreadCount || 0), 0);
}

export async function listFriends() {
  await delay(120);
  return FRIENDS.map((f) => ({ ...f }));
}

export async function listGroups() {
  await delay(120);
  return GROUPS.map((g) => ({ ...g }));
}

export default {
  connect,
  listConversations,
  getConversation,
  getMessages,
  sendTextMessage,
  markConversationRead,
  totalUnread,
  listFriends,
  listGroups,
};
