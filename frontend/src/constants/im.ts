import { MessageType, SessionType } from "@openim/wasm-client-sdk";

export const GroupSessionTypes = [SessionType.Group, SessionType.WorkingGroup];

export const GroupSystemMessageTypes = [
  MessageType.GroupCreated,
  MessageType.GroupInfoUpdated,
  MessageType.MemberQuit,
  MessageType.GroupOwnerTransferred,
  MessageType.MemberKicked,
  MessageType.MemberInvited,
  MessageType.MemberEnter,
  MessageType.GroupDismissed,
  MessageType.GroupMemberMuted,
  MessageType.GroupMuted,
  MessageType.GroupCancelMuted,
  MessageType.GroupMemberCancelMuted,
  MessageType.GroupNameUpdated,
];

export const SystemMessageTypes = [
  MessageType.RevokeMessage,
  MessageType.FriendAdded,
  MessageType.BurnMessageChange,
  ...GroupSystemMessageTypes,
];

export enum CustomType {
  CallingInvite = 200,
  CallingAccept = 201,
  CallingReject = 202,
  CallingCancel = 203,
  CallingHungup = 204,
  // 通话记录：通话结束时由发起方发送一条持久化自定义消息，
  // 在聊天会话里渲染成「语音/视频通话 · 结果 · 时长」的居中提示。
  CallRecord = 205,
}

/** 通话记录结果 */
export enum CallRecordResult {
  Connected = "connected", // 已接通后正常挂断
  Missed = "missed", // 超时未接
  Rejected = "rejected", // 拒接
  Canceled = "canceled", // 主叫取消
}

/** 通话记录自定义消息 data 结构（挂在 customElem.data 里） */
export interface CallRecordData {
  callRecord: true;
  roomID: string;
  inviterUserID: string;
  inviteeUserID: string;
  mediaType: "audio" | "video";
  result: CallRecordResult;
  /** 通话时长（秒），仅 Connected 有效 */
  duration: number;
  /** 发送时间戳（毫秒），用于展示 */
  timestamp: number;
}
