import { MessageItem, MessageType } from "@openim/wasm-client-sdk";
import { FC, memo } from "react";
import { useTranslation } from "react-i18next";

import call_audio from "@/assets/images/chatFooter/call_audio.png";
import call_video from "@/assets/images/chatFooter/call_video.png";
import {
  CallRecordData,
  CallRecordResult,
  CustomType,
} from "@/constants/im";
import { secondsToTime } from "@/utils/common";

import styles from "./message-item.module.scss";

/** 判断一条自定义消息是否是通话记录消息 */
export const isCallRecordMessage = (message: MessageItem): boolean => {
  if (message.contentType !== MessageType.CustomMessage || !message.customElem?.data) {
    return false;
  }
  try {
    const payload = JSON.parse(message.customElem.data) as {
      customType?: number;
      data?: CallRecordData;
    };
    return payload.customType === CustomType.CallRecord && payload.data?.callRecord === true;
  } catch {
    return false;
  }
};

const formatDuration = (seconds: number): string => {
  if (!seconds || seconds <= 0) return "0秒";
  return secondsToTime(seconds);
};

/**
 * 通话记录消息：在聊天会话里渲染成居中提示，样式与系统通知一致。
 * 文案形如：视频通话 · 已接听 · 2分钟3秒 / 语音通话 · 未接听
 */
const CallRecordRender: FC<{ message: MessageItem }> = ({ message }) => {
  const { t } = useTranslation();

  let record: CallRecordData | null = null;
  try {
    const payload = JSON.parse(message.customElem!.data!) as {
      data?: CallRecordData;
    };
    record = payload.data ?? null;
  } catch {
    // 解析失败不渲染具体内容，下方兜底
  }

  if (!record) {
    return <div className={styles.bubble}>{t("messageDescription.callMessage")}</div>;
  }

  const isVideo = record.mediaType === "video";
  const prefix = isVideo ? "Video" : "Audio";

  let text: string;
  switch (record.result) {
    case CallRecordResult.Connected:
      text = t(
        `messageDescription.callRecord${prefix}Connected`,
        { duration: formatDuration(record.duration) },
      );
      break;
    case CallRecordResult.Rejected:
      text = t(`messageDescription.callRecord${prefix}Rejected`);
      break;
    case CallRecordResult.Canceled:
      text = t(`messageDescription.callRecord${prefix}Canceled`);
      break;
    case CallRecordResult.Missed:
    default:
      text = t(`messageDescription.callRecord${prefix}Missed`);
      break;
  }

  return (
    <div
      className="mx-auto flex w-fit items-center gap-1.5 rounded-full bg-[var(--primary-active)] px-3 py-1.5 text-xs text-[var(--sub-text)]"
      title={text}
    >
      <img width={14} height={14} src={isVideo ? call_video : call_audio} alt="" />
      <span>{text}</span>
    </div>
  );
};

export default memo(CallRecordRender);
