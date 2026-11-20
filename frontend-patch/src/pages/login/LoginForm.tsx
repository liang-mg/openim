import { Button, Form, Input } from "antd";
import { t } from "i18next";
import md5 from "md5";
import { useNavigate } from "react-router-dom";

import { useLogin } from "@/api/login";
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
  const [form] = Form.useForm<API.Login.LoginParams>();
  const { mutate: login, isLoading: loginLoading } = useLogin();

  const onFinish = (params: API.Login.LoginParams) => {
    const phoneNumber = (params.phoneNumber ?? "").trim();
    if (!phoneNumber) return;

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
        }}
      >
        <Form.Item
          label="账号"
          name="phoneNumber"
          rules={[{ required: true, message: "请输入账号（手机号）" }]}
        >
          <Input allowClear placeholder="请输入账号（手机号）" autoFocus />
        </Form.Item>

        <Form.Item
          label="密码"
          name="password"
          rules={[{ required: true, message: "请输入密码" }]}
        >
          <Input.Password allowClear placeholder="请输入密码" />
        </Form.Item>

        <div className="mb-10" />

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
