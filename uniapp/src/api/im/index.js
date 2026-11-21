/**
 * IM 适配层入口 —— 页面只 import 这里，不直接碰 SDK。
 *
 * 三个实现：
 *   ./mock.js  内存假数据（imMode = mock，默认）
 *   ./http.js  OA 后端站内通知（imMode = api）：只有系统通知，没有人与人聊天
 *   ./uts.js   OpenIM UTS 原生插件（imMode = sdk，骨架已就位待填）
 *
 * 本文件负责三件与实现无关的事：
 *   1. 连接状态机（idle / connecting / connected / failed）+ 事件广播
 *   2. 统一 Contract（页面只认这些方法）
 *   3. 发送前的连接校验（没连上直接给明确错误，而不是发出去石沉大海）
 *
 * ---- Contract ----
 * connect() / disconnect() / getState() / on(event, cb)
 * listConversations() / getConversation(id)
 * getMessages(id, { before, limit }) -> { list, hasMore }
 * sendTextMessage(id, text) -> Message
 * markConversationRead(id) / totalUnread()
 * listFriends() / listGroups()
 */
import { CONFIG } from "@/config";
import * as http from "./http";
import * as mock from "./mock";
import * as uts from "./uts";

export const IM_MODE = CONFIG.imMode;

const IMPLS = { mock, api: http, sdk: uts };
const impl = IMPLS[IM_MODE] || mock;

let state = "idle";
const listeners = { state: new Set(), message: new Set(), conversation: new Set() };

function emit(event, payload) {
  const set = listeners[event];
  if (!set) return;
  set.forEach((fn) => {
    try {
      fn(payload);
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
/** 只有 mock 是假数据；api/sdk 都是真实链路 */
export const isMock = () => IM_MODE === "mock";

export async function connect() {
  if (state === "connected") return;
  state = "connecting";
  emit("state", state);
  try {
    await impl.connect();
    state = "connected";
    emit("state", state);
  } catch (e) {
    state = "failed";
    emit("state", state);
    throw e;
  }
}

export function disconnect() {
  state = "idle";
  emit("state", state);
}

export async function listConversations() {
  return impl.listConversations();
}

export async function getConversation(conversationID) {
  return impl.getConversation(conversationID);
}

export async function getMessages(conversationID, options) {
  return impl.getMessages(conversationID, options);
}

export async function sendTextMessage(conversationID, text) {
  if (state !== "connected") throw new Error("IM 未连接");
  const res = await impl.sendTextMessage(conversationID, text);
  // 两个实现返回结构可能不同，这里统一成 Message，并把会话变更广播出去
  const message = res && res.message ? res.message : res;
  if (res && res.conversation) emit("conversation", res.conversation);
  emit("message", { conversationID, message });
  return message;
}

export async function markConversationRead(conversationID) {
  return impl.markConversationRead(conversationID);
}

export async function totalUnread() {
  return impl.totalUnread();
}

export async function listFriends() {
  return impl.listFriends();
}

export async function listGroups() {
  return impl.listGroups();
}

export default {
  IM_MODE,
  isMock,
  connect,
  disconnect,
  getState,
  on,
  listConversations,
  getConversation,
  getMessages,
  sendTextMessage,
  markConversationRead,
  totalUnread,
  listFriends,
  listGroups,
};
