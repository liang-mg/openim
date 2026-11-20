import { v4 as uuidv4 } from "uuid";

import createAxiosInstance from "@/utils/request";
import { resolveServerURLs } from "@/utils/serverConfig";
import { getChatToken } from "@/utils/storage";

const request = createAxiosInstance(() => resolveServerURLs().chat);

export const getRtcConnectData = async (room: string, identity: string) => {
  const token = (await getChatToken()) as string;
  const { data } = await request.post<{ serverUrl: string; token: string }>(
    "/user/rtc/get_token",
    {
      room,
      identity,
    },
    {
      headers: {
        token,
        operationID: uuidv4(),
      },
    },
  );
  // 后端返回的是容器内网地址（如 ws://127.0.0.1:7880），客户端直连不通。
  // Web 改写为同源 /livekit 由 nginx 反代；桌面端由运行时配置派生完整地址。
  return {
    data: {
      ...data,
      serverUrl: resolveServerURLs().livekit,
    },
  };
};
