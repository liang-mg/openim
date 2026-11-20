import axios from "axios";
import { t } from "i18next";
import { v4 as uuidv4 } from "uuid";

import { useUserStore } from "@/store";

import { getChatToken, getIMToken } from "./storage";
import { feedbackToast } from "./common";

const tokenErrorCodeList = [1501, 1503, 1504, 1505];

/**
 * baseURL 支持函数（惰性解析）：桌面端服务器地址是登录时填的，模块加载阶段还读不到，
 * 必须在每次请求时重新解析。传字符串时行为与改造前完全一致（Web 端走这条）。
 */
const createAxiosInstance = (
  baseURL: string | (() => string),
  imToken = true,
) => {
  const resolveBaseURL = () =>
    typeof baseURL === "function" ? baseURL() : baseURL;
  const serves = axios.create({
    baseURL: resolveBaseURL(),
    timeout: 25000,
  });

  serves.interceptors.request.use(
    async (config) => {
      // 每次请求刷新地址：桌面端切换服务器/首次填写后无需重建实例
      config.baseURL = resolveBaseURL();
      const token = imToken ? await getIMToken() : await getChatToken();
      config.headers.token = config.headers.token ?? token;
      config.headers.operationID = uuidv4();
      return config;
    },
    (err) => Promise.reject(err),
  );

  serves.interceptors.response.use(
    (res) => {
      if (tokenErrorCodeList.includes(res.data.errCode)) {
        feedbackToast({
          msg: t("toast.loginExpiration"),
          error: t("toast.loginExpiration"),
          onClose: () => {
            useUserStore.getState().userLogout(true);
          },
        });
      }
      if (res.data.errCode !== 0) {
        return Promise.reject(res.data);
      }
      return res.data;
    },
    (err) => {
      if (err.message.includes("timeout")) {
        console.error("error", err);
      }
      if (err.message.includes("Network Error")) {
        console.error("error", err);
      }
      return Promise.reject(err);
    },
  );

  return serves;
};

export default createAxiosInstance;
