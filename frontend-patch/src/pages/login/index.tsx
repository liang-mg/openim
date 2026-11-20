import { t } from "i18next";
import { useState } from "react";
import { useCopyToClipboard } from "react-use";

import login_bg from "@/assets/images/login/login_bg.png";
import WindowControlBar from "@/components/WindowControlBar";
import { APP_NAME, APP_VERSION, SDK_VERSION } from "@/config";
import { feedbackToast } from "@/utils/common";
import { isElectronRuntime } from "@/utils/serverConfig";

import styles from "./index.module.scss";
import LoginForm from "./LoginForm";
import ModifyForm from "./ModifyForm";
// import RegisterForm from "./RegisterForm";

export type FormType = 0 | 1 ;

export const Login = () => {
  // 0login 1resetPassword 2register
  const [formType, setFormType] = useState<FormType>(0);
  // 桌面端多一个服务器地址输入框，卡片需要更高
  const cardHeight = isElectronRuntime() ? "!h-[540px]" : "h-[450px]";

  const [, copyToClipboard] = useCopyToClipboard();

  const handleCopy = () => {
    copyToClipboard(`${`${APP_NAME} ${APP_VERSION}`}/${SDK_VERSION}`);
    feedbackToast({ msg: t("toast.copySuccess") });
  };

  return (
    <div className="relative flex h-full flex-col">
      <div className="app-drag relative h-10 bg-[var(--top-search-bar)] max-[600px]:hidden">
        <WindowControlBar />
      </div>
      <div className="flex flex-1 items-center justify-center px-4 max-[600px]:px-3">
        <div className="no-mobile">
          <LeftBar />
        </div>
        <div
          className={`${styles.login} ${cardHeight} mr-14 w-[350px] rounded-md p-11 max-[600px]:!mr-0 max-[600px]:!h-auto max-[600px]:!w-full max-[600px]:!max-w-[380px] max-[600px]:!p-6`}
          style={{ boxShadow: "0 0 30px rgba(0,0,0,.1)" }}
        >
          {formType === 0 && <LoginForm />}
          {formType === 1 && (
            <ModifyForm setFormType={setFormType} loginMethod="phone" />
          )}
          {/* {formType === 2 && (
            <RegisterForm loginMethod={loginMethod} setFormType={setFormType} />
          )} */}
        </div>
      </div>
      <div
        className="absolute bottom-3 right-3 flex cursor-pointer flex-col items-center text-xs"
        onClick={handleCopy}
      >
        <div className="text-[var(--sub-text)]">{`${APP_NAME} ${APP_VERSION}`}</div>
        <div className="text-[var(--sub-text)]">{SDK_VERSION}</div>
      </div>
    </div>
  );
};

const LeftBar = () => {
  return (
    <div className="flex min-h-[420]">
      <div className="mr-14 text-center">
        <div className="text-2xl">{t("placeholder.title")}</div>
        <span className="text-sm  text-gray-400">{t("placeholder.subTitle")}</span>
        <img src={login_bg} alt="login_bg" />
      </div>
    </div>
  );
};
