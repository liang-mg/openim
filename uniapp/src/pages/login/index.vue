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

      <text class="login__version">{{ appName }} {{ appVersion }} · {{ buildTag }}</text>
      <text class="login__env" :class="{ 'login__env--custom': overrideActive }">接口：{{ envText }}</text>
      <view v-if="loginError" class="login__error">
        <text class="login__error-title">登录失败</text>
        <text class="login__error-text">{{ loginError.message }}</text>
        <text v-if="loginError.detail && loginError.detail.url" class="login__error-detail">请求地址：{{ loginError.detail.url }}</text>
        <text v-if="loginError.detail && loginError.detail.httpStatus" class="login__error-detail">HTTP：{{ loginError.detail.httpStatus }} · Content-Type：{{ loginError.detail.contentType || "未知" }}</text>
        <text v-if="loginError.detail && loginError.detail.bodyPreview" class="login__error-detail">返回：{{ loginError.detail.bodyPreview }}</text>
      </view>
      <view v-if="overrideActive" class="login__reset" @tap="resetEnv">
        <text class="login__reset-text">当前是自定义接口地址，点此恢复默认生产接口</text>
      </view>
    </view>
  </view>
</template>

<script>
import { CONFIG, HOME_PATH, DEV_LOGIN_ENABLED } from "@/config";
import { loginByPassword, loginByDevToken, describeLoginError } from "@/api/auth";
import { connect } from "@/api/im";
import { getLoginAccount, setLoginAccount, getToken } from "@/utils/storage";
import { getOverride, clearOverride } from "@/utils/runtimeConfig";
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
      buildTag: CONFIG.buildTag,
      devEnabled: DEV_LOGIN_ENABLED,
      account: "",
      password: "",
      loading: false,
      imUnreachable: false,
      overrideActive: false,
      loginError: null,
    };
  },
  onLoad() {
    // 已有登录态直接进首页，避免重复登录
    if (getToken()) {
      uni.switchTab({ url: HOME_PATH });
      return;
    }
    const saved = getLoginAccount();
    if (saved) this.account = saved;
    this.overrideActive = Boolean(CONFIG.allowOverride) && Boolean(getOverride());
  },
  computed: {
    envText() {
      const origin = CONFIG.rawImOrigin || CONFIG.rawOrigin || "";
      return origin ? `${CONFIG.envName} · ${origin}` : `${CONFIG.envName} · 同源`;
    },
  },
  methods: {
    resetEnv() {
      clearOverride();
      this.overrideActive = false;
      uni.showToast({ title: "已恢复默认生产接口，正在重启", icon: "none", duration: 1800 });
      setTimeout(() => {
        // #ifdef APP-PLUS
        try {
          plus.runtime.restart();
        } catch (e) {
          uni.reLaunch({ url: "/pages/login/index" });
        }
        // #endif
        // #ifdef H5
        location.reload();
        // #endif
      }, 700);
    },
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
      this.loginError = null;
      try {
        await loginByPassword({ account, password });
        setLoginAccount(account);
        // 登录成功就并行建立 IM 长连接；失败不阻塞跳转，消息页会提示并允许重试
        connect().catch(() => {});
        uni.showToast({ title: "登录成功", icon: "success" });
        setTimeout(() => uni.switchTab({ url: HOME_PATH }), 200);
      } catch (e) {
        const msg = describeLoginError(e);
        this.imUnreachable = msg.includes("不可达");
        this.loginError = { message: msg, detail: e.detail || null };
        uni.showToast({ title: msg, icon: "none", duration: 3200 });
      } finally {
        this.loading = false;
      }
    },
    onDevLogin() {
      try {
        loginByDevToken();
        connect().catch(() => {});
        uni.switchTab({ url: HOME_PATH });
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

.login__env {
  margin-top: 5px;
  text-align: center;
  font-size: 10px;
  color: var(--ink-4);
  word-break: break-all;
  padding: 0 12px;
}

.login__env--custom {
  color: #ad6800;
}

.login__reset {
  margin: 10px auto 0;
  padding: 5px 10px;
  border-radius: 12px;
  background: #fff7e6;
  border: 1px solid #ffe0b2;
}

.login__reset-text {
  font-size: 10px;
  color: #ad6800;
}

.login__error {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: #fff1f0;
  border: 1px solid #ffccc7;
}

.login__error-title {
  display: block;
  font-size: 12px;
  font-weight: 600;
  color: #a8071a;
  margin-bottom: 4px;
}

.login__error-text {
  display: block;
  font-size: 11px;
  line-height: 1.55;
  color: #a8071a;
  word-break: break-all;
}

.login__error-detail {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  line-height: 1.5;
  color: #8c4a4a;
  word-break: break-all;
}
</style>
