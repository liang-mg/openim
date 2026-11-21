import "@livekit/components-styles";

import { LiveKitRoom } from "@livekit/components-react";
import { t } from "i18next";
import {
  forwardRef,
  ForwardRefRenderFunction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import DraggableModalWrap from "@/components/DraggableModalWrap";
import { CallRecordData, CallRecordResult, CustomType } from "@/constants";
import { OverlayVisibleHandle, useOverlayVisible } from "@/hooks/useOverlayVisible";
import { IMSDK } from "@/layout/MainContentWrap";
import { useUserStore } from "@/store";
import { feedbackToast } from "@/utils/common";

import { AuthData, InviteData } from "./data";
import { RtcLayout } from "./RtcLayout";

interface IRtcCallModalProps {
  inviteData: InviteData;
}

const RtcCallModal: ForwardRefRenderFunction<
  OverlayVisibleHandle,
  IRtcCallModalProps
> = ({ inviteData }, ref) => {
  const { invitation } = inviteData;
  const [connect, setConnect] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [authData, setAuthData] = useState<AuthData>({
    serverUrl: "",
    token: "",
  });
  const selfID = useUserStore((state) => state.selfInfo.userID);
  const { isOverlayOpen, closeOverlay } = useOverlayVisible(ref);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  // 记录真正接通的时刻，用于计算通话时长（秒）
  const connectedAtRef = useRef<number | null>(null);
  // 防止同一场通话重复写入记录（挂断信号 + onDisconnected 可能同时触发）
  const recordSentRef = useRef(false);

  const isRecv = selfID !== invitation?.inviterUserID;

  const clearTimer = useCallback(() => clearTimeout(timer.current), []);

  const closeOverlayAndClearTimer = useCallback(() => {
    clearTimer();
    closeOverlay();
  }, [clearTimer, closeOverlay]);

  const sendCustomSignal = useCallback(
    async (recvID: string, customType: CustomType) => {
      const data = {
        customType,
        data: {
          ...invitation,
        },
      };
      const { data: message } = await IMSDK.createCustomMessage({
        data: JSON.stringify(data),
        extension: "",
        description: "",
      });
      await IMSDK.sendMessage({
        recvID,
        message,
        groupID: "",
        isOnlineOnly: true,
      });
    },
    [invitation],
  );

  // 发送一条持久化的通话记录消息（非 isOnlineOnly），在聊天会话里展示。
  // 只由发起方（主叫）发送，避免双方各写一条；接收方通过同一条消息即可看到。
  const sendCallRecord = useCallback(
    async (result: CallRecordResult) => {
      if (isRecv || recordSentRef.current) return;
      const recvID = invitation?.inviteeUserIDList[0];
      if (!recvID) return;
      recordSentRef.current = true;

      const duration =
        result === CallRecordResult.Connected && connectedAtRef.current
          ? Math.max(1, Math.round((Date.now() - connectedAtRef.current) / 1000))
          : 0;
      const record: CallRecordData = {
        callRecord: true,
        roomID: invitation?.roomID ?? "",
        inviterUserID: invitation?.inviterUserID ?? selfID,
        inviteeUserID: recvID,
        mediaType: invitation?.mediaType === "video" ? "video" : "audio",
        result,
        duration,
        timestamp: Date.now(),
      };
      try {
        const { data: message } = await IMSDK.createCustomMessage({
          data: JSON.stringify({ customType: CustomType.CallRecord, data: record }),
          extension: "",
          description: "",
        });
        // 持久化消息：对方不在线也能留存，构成可追溯的通话记录
        await IMSDK.sendMessage({
          recvID,
          message,
          groupID: "",
          isOnlineOnly: false,
        });
      } catch (error) {
        // 记录写入失败不应影响通话流程
        console.warn("sendCallRecord failed", error);
      }
    },
    [invitation, isRecv, selfID],
  );

  const checkTimeout = useCallback(() => {
    clearTimer();
    timer.current = setTimeout(() => {
      clearTimer();
      const recvID = invitation?.inviteeUserIDList[0];
      if (!recvID) return;
      void sendCustomSignal(recvID, CustomType.CallingCancel);
      // 主叫超时未接通 → 记为「未接听」
      void sendCallRecord(CallRecordResult.Missed);
      closeOverlay();
    }, (invitation?.timeout ?? 30) * 1000);
  }, [clearTimer, closeOverlay, invitation, sendCustomSignal, sendCallRecord]);

  const tryInvite = useCallback(async () => {
    const recvID = invitation?.inviteeUserIDList[0];
    if (!isRecv && recvID) {
      try {
        await sendCustomSignal(recvID, CustomType.CallingInvite);
        checkTimeout();
      } catch (error) {
        feedbackToast({ msg: t("toast.inviteUserFailed"), error });
        closeOverlay();
      }
    }
  }, [
    checkTimeout,
    closeOverlay,
    invitation?.inviteeUserIDList,
    isRecv,
    sendCustomSignal,
  ]);

  useEffect(() => {
    if (!isOverlayOpen) return;
    void tryInvite();
  }, [isOverlayOpen, tryInvite]);

  const connectRtc = useCallback(
    (data?: AuthData) => {
      if (data) {
        setAuthData(data);
      }
      clearTimer();
      setTimeout(() => setConnect(true));
    },
    [clearTimer],
  );

  return (
    <DraggableModalWrap
      title={null}
      footer={null}
      open={isOverlayOpen}
      closable={false}
      maskClosable={false}
      keyboard={false}
      mask={false}
      centered
      width="auto"
      onCancel={closeOverlayAndClearTimer}
      destroyOnClose
      ignoreClasses=".ignore-drag, .no-padding-modal, .cursor-pointer"
      className="no-padding-modal rtc-single-modal"
      wrapClassName="pointer-events-none"
    >
      <div>
        {isOverlayOpen && (
          <LiveKitRoom
            serverUrl={authData.serverUrl}
            token={authData.token}
            video={invitation?.mediaType === "video"}
            audio={true}
            connect={connect}
            options={{
              publishDefaults: {
                videoCodec: "vp9",
                backupCodec: { codec: "vp8" },
              },
            }}
            onConnected={() => {
              connectedAtRef.current = Date.now();
              setIsConnected(true);
            }}
            onDisconnected={() => {
              // 兜底：接通后因对端断网/媒体异常被动断开时，也补记一条通话记录。
              // 正常挂断已在 hungup/hangupHandler 记过，recordSentRef 会防止重复。
              if (connectedAtRef.current) void sendCallRecord(CallRecordResult.Connected);
              closeOverlayAndClearTimer();
              setIsConnected(false);
              setConnect(false);
            }}
          >
            <RtcLayout
              connect={connect}
              isConnected={isConnected}
              isRecv={isRecv}
              inviteData={inviteData}
              sendCustomSignal={sendCustomSignal}
              connectRtc={connectRtc}
              closeOverlay={closeOverlayAndClearTimer}
              sendCallRecord={sendCallRecord}
            />
          </LiveKitRoom>
        )}
      </div>
    </DraggableModalWrap>
  );
};

export default forwardRef(RtcCallModal);
