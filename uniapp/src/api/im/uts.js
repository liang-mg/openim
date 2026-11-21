/**
 * 真实 IM 实现骨架：OpenIM 官方 uni-app UTS 原生插件。
 *
 * 现状：**未接入**（本机没有 IM 服务，也没有插件包）。这个文件先把「要写什么」钉死，
 * 插件一到位，按下面的 TODO 填函数体即可，13 个页面一行不用改。
 *
 * 安装（到这一步才需要）：
 *   1. 把 openim-uniapp-sdk 放进 uniapp/src/uni_modules/（或按官方文档装 UTS 插件）
 *   2. manifest.json → App 模块配置 → 勾选插件所需模块（推送/存储）
 *   3. .env.production / .env.dev.local 里设 VITE_IM_MODE=sdk
 *
 * 插件对外 API 名称以官方文档为准（docs.openim.io/sdk/uniapp），下面注释里用的是常见命名，
 * 接入时以插件实际导出的方法名为准 —— 这也是为什么每个方法都单独写一行 TODO，而不是一股脑抄进来。
 */

const PLUGIN_NAME = "openim-uniapp-sdk";

let plugin = null;

function sdk() {
  if (plugin) return plugin;
  // #ifdef APP-PLUS
  try {
    plugin = uni.requireNativePlugin(PLUGIN_NAME);
  } catch (e) {
    plugin = null;
  }
  // #endif
  if (!plugin) {
    throw new Error(
      `OpenIM UTS 插件未安装（${PLUGIN_NAME}）。请先按 docs/移动端-打包与推送预案.md 安装插件，或把 VITE_IM_MODE 改回 mock。`
    );
  }
  return plugin;
}

/** 统一的「未实现」错误，避免调用方拿到 undefined 后静默失败 */
function todo(name, hint) {
  throw new Error(`[im/uts] ${name} 未接入：${hint}`);
}

export async function connect() {
  const api = sdk();
  // TODO 1: 初始化
  //   api.initSDK({ platformID, apiAddr, wsAddr, dataDir, logLevel })
  //   apiAddr / wsAddr 取自 config：CONFIG.chatBase（/chat 前缀）与 CONFIG.wsUrl
  // TODO 2: 登录（token 来自 utils/storage 的 getIMToken，不是 chatToken）
  //   api.login({ userID, token })
  // TODO 3: 注册事件转发（新消息 / 连接状态 / 被踢下线）
  //   api.onConnectListener / onRecvNewMessages ... → 通过 ../im/index.js 的 emit 抛出去
  void api;
  todo("connect", "见本文件 TODO 1-3");
}

export async function listConversations() {
  const api = sdk();
  // TODO: api.getAllConversationList() → 映射成 Conversation
  //   { conversationID, showName, faceURL, isGroup, unreadCount,
  //     lastMessage: { text, sendTime, senderName } }
  void api;
  todo("listConversations", "映射 getAllConversationList");
}

export async function getConversation() {
  todo("getConversation", "从会话列表里取，或调 api.getOneConversation");
}

export async function getMessages() {
  const api = sdk();
  // TODO: api.getAdvancedHistoryMessageList({ conversationID, startClientMsgID, count })
  //   注意 OpenIM 是「从最新往前翻」，要按 before/sendTime 换算游标
  void api;
  todo("getMessages", "映射 getAdvancedHistoryMessageList");
}

export async function sendTextMessage() {
  const api = sdk();
  // TODO: const msg = await api.createTextMessage({ conversationID, text })
  //       await api.sendMessage({ message: msg, recvID, groupID })
  void api;
  todo("sendTextMessage", "createTextMessage + sendMessage");
}

export async function markConversationRead() {
  const api = sdk();
  // TODO: api.markConversationMessageAsRead({ conversationID })
  void api;
  todo("markConversationRead", "markConversationMessageAsRead");
}

export async function totalUnread() {
  const api = sdk();
  // TODO: api.getTotalUnreadMsgCount()
  void api;
  todo("totalUnread", "getTotalUnreadMsgCount");
}

export async function listFriends() {
  const api = sdk();
  // TODO: api.getFriendList() → { userID, nickname, faceURL, ... }
  void api;
  todo("listFriends", "getFriendList");
}

export async function listGroups() {
  const api = sdk();
  // TODO: api.getJoinedGroupList() → { groupID, groupName, memberCount }
  void api;
  todo("listGroups", "getJoinedGroupList");
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
