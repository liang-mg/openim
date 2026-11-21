<template>
  <view class="app-page login">
    <view class="login__body">
      <view class="login__brand">
        <image class="login__logo" src="/static/brand/logo-xinbo.png" mode="aspectFit" />
        <text class="login__title">{{ appName }}</text>
        <text class="login__sub">移动端 · 打卡 / 出勤 / 日报 / 沟通</text>
      </view>

      <view class="login__card">
        <login-form
          v-model:account="account"
          v-model:password="password"
          :loading="loading"
          :dev-enabled="devEnabled"
          :im-unreachable="imUnreachable"
          @submit="onLogin"
          @dev-login="onDevLogin"
        />
      </view>

      <text class="login__version">{{ appName }} {{ appVersion }}</text>
    </view>
  </view>
</template>

<script>
import { CONFIG, HOME_PATH, DEV_LOGIN_ENABLED } from "@/config";
import { loginByPassword, loginByDevToken, describeLoginError } from "@/api/auth";
import { getLoginAccount, setLoginAccount, getToken } from "@/utils/storage";
import LoginForm from "./components/login-form.vue";

/**
 * 登录页。与 PC 端 frontend/src/pages/login/LoginForm.tsx 对齐：
 * 账号即手机号 + 密码（md5），账号体系归 IM。
 *
 * 本地没有 IM 服务时，用 .env.dev.local 的 VITE_DEV_TOKEN 走「本地联调进入」。
 */
export default {
  components: { LoginForm },
  data() {
    return {
      appName: CONFIG.appName,
      appVersion: CONFIG.appVersion,
      devEnabled: DEV_LOGIN_ENABLED,
      account: "",
      password: "",
      loading: false,
      imUnreachable: false,
    };
  },
  onLoad() {
    // 已有登录态直接进首页，避免重复登录
    if (getToken()) {
      uni.reLaunch({ url: HOME_PATH });
      return;
    }
    const saved = getLoginAccount();
    if (saved) this.account = saved;
  },
  methods: {
    async onLogin() {
      if (this.loading) return;
      const account = String(this.account || "").trim();
      const password = String(this.password || "");
      if (!account) {
        uni.showToast({ title: "请输入账号", icon: "none" });
        return;
      }
      if (!password) {
        uni.showToast({ title: "请输入密码", icon: "none" });
        return;
      }
      this.loading = true;
      try {
        await loginByPassword({ account, password });
        setLoginAccount(account);
        uni.showToast({ title: "登录成功", icon: "success" });
        setTimeout(() => uni.reLaunch({ url: HOME_PATH }), 200);
      } catch (e) {
        const msg = describeLoginError(e);
        this.imUnreachable = msg.includes("不可达");
        uni.showToast({ title: msg, icon: "none", duration: 3200 });
      } finally {
        this.loading = false;
      }
    },
    onDevLogin() {
      try {
        loginByDevToken();
        uni.reLaunch({ url: HOME_PATH });
      } catch (e) {
        uni.showToast({ title: e.message || "本地登录失败", icon: "none" });
      }
    },
  },
};
</script>

<style scoped>
.login {
  background: linear-gradient(180deg, var(--brand-soft) 0%, #f4f6f9 42%);
}

.login__body {
  min-height: 100vh;
  min-height: 100dvh;
  padding: 56px 22px 24px;
  display: flex;
  flex-direction: column;
}

.login__brand {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  margin-bottom: 26px;
}

.login__logo {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: block;
  box-shadow: 0 8px 20px rgba(11, 95, 216, 0.18);
}

.login__title {
  font-size: 20px;
  font-weight: 600;
  color: var(--ink);
}

.login__sub {
  font-size: 12px;
  color: var(--ink-3);
}

.login__card {
  background: #fff;
  border-radius: 16px;
  padding: 20px 18px 22px;
  box-shadow: 0 10px 30px rgba(15, 35, 70, 0.08);
}













.login__version {
  margin-top: auto;
  text-align: center;
  font-size: 11px;
  color: var(--ink-4);
  padding-top: 18px;
}
</style>
