/**
 * 未发送/发送失败消息的本地暂存（按用户 + 会话隔离）。
 *
 * 为什么需要：聊天页的「发送中」气泡只存在内存里，退出页面就丢；
 * 网络/VPN 抖动时用户会以为消息发出去了。这里把待发送记录落本地，
 * 重进会话能恢复成「发送失败，点击重发」，成功后再删除。
 *
 * 只存文本；记录结构：
 *   { clientMsgID, conversationID, text, sendTime, status, error, retryCount, updatedAt }
 */
const KEY = "oa_im_outbox_v1";
const MAX_PER_USER = 300;

function readAll() {
  try {
    const v = uni.getStorageSync(KEY);
    if (!v) return {};
    if (typeof v === "string") {
      try {
        return JSON.parse(v) || {};
      } catch (e) {
        return {};
      }
    }
    return typeof v === "object" ? v : {};
  } catch (e) {
    return {};
  }
}

function writeAll(all) {
  try {
    uni.setStorageSync(KEY, all || {});
  } catch (e) {
    console.warn("[imOutbox] write failed", e);
  }
}

function bucket(all, userID) {
  const uid = String(userID || "");
  if (!uid) return null;
  if (!all[uid] || typeof all[uid] !== "object") all[uid] = {};
  return all[uid];
}

/** 某会话的待发送/失败消息，按发送时间升序 */
export function list(userID, conversationID) {
  const all = readAll();
  const b = bucket(all, userID);
  if (!b) return [];
  const rows = b[String(conversationID || "")] || [];
  return rows.slice().sort((a, b2) => (a.sendTime || 0) - (b2.sendTime || 0));
}

/** 新增/更新一条记录（按 clientMsgID 去重） */
export function upsert(userID, record) {
  if (!userID || !record || !record.clientMsgID || !record.conversationID) return;
  const all = readAll();
  const b = bucket(all, userID);
  if (!b) return;
  const cid = String(record.conversationID);
  const rows = Array.isArray(b[cid]) ? b[cid] : [];
  const next = {
    clientMsgID: String(record.clientMsgID),
    conversationID: cid,
    text: String(record.text || ""),
    sendTime: Number(record.sendTime || Date.now()),
    status: record.status === "sending" ? "sending" : "failed",
    error: String(record.error || ""),
    retryCount: Number(record.retryCount || 0),
    updatedAt: Date.now(),
  };
  const idx = rows.findIndex((x) => x.clientMsgID === next.clientMsgID);
  if (idx >= 0) rows[idx] = next;
  else rows.push(next);
  // 单用户最多 300 条，避免长期占空间
  b[cid] = rows.slice(-MAX_PER_USER);
  writeAll(all);
}

export function remove(userID, conversationID, clientMsgID) {
  if (!userID || !conversationID || !clientMsgID) return;
  const all = readAll();
  const b = bucket(all, userID);
  if (!b) return;
  const cid = String(conversationID);
  const rows = Array.isArray(b[cid]) ? b[cid] : [];
  b[cid] = rows.filter((x) => x.clientMsgID !== String(clientMsgID));
  if (!b[cid].length) delete b[cid];
  writeAll(all);
}

export function clearConversation(userID, conversationID) {
  if (!userID || !conversationID) return;
  const all = readAll();
  const b = bucket(all, userID);
  if (!b) return;
  delete b[String(conversationID)];
  writeAll(all);
}

export function clearUser(userID) {
  if (!userID) return;
  const all = readAll();
  delete all[String(userID)];
  writeAll(all);
}

export function clearAll() {
  try {
    uni.removeStorageSync(KEY);
  } catch (e) {
    /* ignore */
  }
}

export default { list, upsert, remove, clearConversation, clearUser, clearAll };
