import { v4 as uuidv4 } from "uuid";

import createAxiosInstance from "@/utils/request";
import { getChatToken } from "@/utils/storage";

const request = createAxiosInstance(import.meta.env.VITE_CHAT_URL);

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
  // 后端返回 ws://127.0.0.1:7880，公网隧道下浏览器会连到访问者自己的机器。
  // 统一改写为同源 /livekit，由 vite / nginx 反代到本机 LiveKit。
  const wsProtocol = window.location.protocol === "https:" ? "wss" : "ws";
  return {
    data: {
      ...data,
      serverUrl: `${wsProtocol}://${window.location.host}/livekit`,
    },
  };
};
