<template>
  <view class="login-form">
    <text class="block text-lg font-semibold text-ink mb-4">账号密码登录</text>

    <view class="mb-3.5">
      <text class="block text-sm text-ink-2 mb-1.5">账号</text>
      <input
        :value="account"
        class="field__input login-input h-11 px-3 rounded-ctl bg-fill text-md text-ink"
        type="text"
        placeholder="请输入账号（手机号）"
        placeholder-class="text-ink-4"
        :adjust-position="true"
        @input="$emit('update:account', $event.detail.value)"
      />
    </view>

    <view class="mb-4">
      <text class="block text-sm text-ink-2 mb-1.5">密码</text>
      <input
        :value="password"
        class="field__input login-input h-11 px-3 rounded-ctl bg-fill text-md text-ink"
        password
        placeholder="请输入密码"
        placeholder-class="text-ink-4"
        @input="$emit('update:password', $event.detail.value)"
        @confirm="$emit('submit')"
      />
    </view>

    <view class="primary-btn login-submit h-12 rounded-ctl bg-brand flex items-center justify-center" :class="{ 'opacity-55': loading }" @tap="$emit('submit')">
      <text class="text-lg text-white font-medium">{{ loading ? "登录中…" : "登录" }}</text>
    </view>

    <view v-if="devEnabled" class="mt-3 h-10 rounded-ctl bg-brand-soft flex items-center justify-center" @tap="$emit('dev-login')">
      <text class="text-base text-brand">本地联调进入（跳过 IM 登录）</text>
    </view>

    <!-- 探测到 IM 未启动时，别让人对着"登录失败"猜 -->
    <view v-if="imUnreachable" class="flex gap-2 mt-3 p-2.5 rounded-ctl bg-warn-soft">
      <app-icon name="warning" :size="15" tone="warn-text" />
      <view class="flex-1 min-w-0">
        <text class="block text-sm font-semibold text-warn-text mb-1">IM 登录服务未连接</text>
        <text class="block text-xs leading-relaxed text-warn-text">
          登录走的是 openim-chat（/chat 接口，默认 10008），不是 OA 后端（10010）。当前该服务未启动，账号密码无法校验。
        </text>
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 登录表单（纯展示 + 事件）。
 *
 * 账号/密码是可编辑状态，所以走 update:account / update:password 双向上抛，
 * 由页面持有；提交、联调入口、IM 未连接提示都只抛事件，页面决定怎么处理。
 */
export default {
  name: "LoginForm",
  components: { AppIcon },
  props: {
    account: { type: String, default: "" },
    password: { type: String, default: "" },
    loading: { type: Boolean, default: false },
    devEnabled: { type: Boolean, default: false },
    imUnreachable: { type: Boolean, default: false },
  },
  emits: ["update:account", "update:password", "submit", "dev-login"],
};
</script>
