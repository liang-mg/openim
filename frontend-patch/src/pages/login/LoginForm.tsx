import { Button, Form, Input } from "antd";
import { t } from "i18next";
import md5 from "md5";
import { useNavigate } from "react-router-dom";

import { useLogin } from "@/api/login";
import {
  getServerHost,
  isElectronRuntime,
  setServerHost,
} from "@/utils/serverConfig";
import {
  getPhoneNumber,
  setAreaCode,
  setIMProfile,
  setPhoneNumber,
} from "@/utils/storage";

import styles from "./index.module.scss";

// OA 登录统一用「账号 + 密码」，账号即手机号。
// 账号体系归 IM 管，OA 只复用它签发的 chatToken，不再提供邮箱/验证码入口。
const AREA_CODE = "+86";

const LoginForm = () => {
  const navigate = useNavigate();
  const [form] = Form.useForm<API.Login.LoginParams & { serverHost?: string }>();
  const { mutate: login, isLoading: loginLoading } = useLogin();

  // 只有桌面端生产模式需要填服务器地址；Web / Electron dev 由同源代理决定
  const needServerHost = isElectronRuntime();

  const onFinish = (params: API.Login.LoginParams & { serverHost?: string }) => {
    const phoneNumber = (params.phoneNumber ?? "").trim();
    if (!phoneNumber) return;

    // 桌面端先保存服务器地址，后续所有 API 与 IM SDK 立即使用新地址
    if (needServerHost) {
      const host = (params.serverHost ?? "").trim();
      if (!host) return;
      setServerHost(host);
    }

    params.password = md5(params.password ?? "");
    params.areaCode = AREA_CODE;
    params.phoneNumber = phoneNumber;

    setAreaCode(AREA_CODE);
    setPhoneNumber(phoneNumber);

    login(params, {
      onSuccess: (data) => {
        const { chatToken, imToken, userID } = data.data;
        setIMProfile({ chatToken, imToken, userID });
        navigate("/chat");
      },
    });
  };

  return (
    <>
      <div className="flex flex-row items-center justify-between">
        <div className="text-xl font-medium">{t("placeholder.welcome")}</div>
      </div>
      <div className={`mt-6 ${styles["login-method-tab"]}`}>账号密码登录</div>
      <Form
        form={form}
        layout="vertical"
        onFinish={onFinish}
        autoComplete="off"
        labelCol={{ prefixCls: "custom-form-item" }}
        initialValues={{
          phoneNumber: getPhoneNumber() ?? "",
          serverHost: getServerHost(),
        }}
      >
        {needServerHost && (
          <Form.Item
            label="服务器地址"
            name="serverHost"
            rules={[{ required: true, message: "请输入服务器域名或 IP" }]}
            extra="只填域名或 IP，例如 oa.company.com，程序自动连接各服务"
          >
            <Input allowClear placeholder="例如 oa.company.com" />
          </Form.Item>
        )}

        <Form.Item
          label="账号"
          name="phoneNumber"
          rules={[{ required: true, message: "请输入账号（手机号）" }]}
        >
          <Input allowClear placeholder="请输入账号（手机号）" autoFocus={!needServerHost} />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password allowClear placeholder="请输入密码" />
        </Form.Item>

        <div className={needServerHost ? "mb-4" : "mb-10"} />

        <Form.Item className="mb-4">
          <Button type="primary" htmlType="submit" block loading={loginLoading}>
            {t("placeholder.login")}
          </Button>
        </Form.Item>
      </Form>
    </>
  );
};

export default LoginForm;
