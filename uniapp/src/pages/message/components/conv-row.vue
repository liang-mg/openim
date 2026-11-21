<template>
  <view class="conv-row flex items-center gap-3 px-3.5 py-3 bg-white border-b border-line" @tap="$emit('open', conv)">
    <view class="relative shrink-0">
      <oim-avatar :text="(conv.showName || '?').slice(0, 1)" :size="46" />
      <view v-if="conv.isGroup" class="absolute -right-0.5 -bottom-0.5 w-4 h-4 rounded bg-brand flex items-center justify-center">
        <text class="text-2xs text-white leading-none">群</text>
      </view>
    </view>

    <view class="flex-1 min-w-0">
      <view class="flex items-center justify-between gap-2">
        <text class="text-md font-medium text-ink overflow-hidden whitespace-nowrap" style="text-overflow: ellipsis">{{ conv.showName }}</text>
        <text class="text-2xs text-ink-4 shrink-0">{{ timeText }}</text>
      </view>

      <view class="flex items-center justify-between gap-2 mt-1">
        <text class="flex-1 min-w-0 text-sm text-ink-3 overflow-hidden whitespace-nowrap" style="text-overflow: ellipsis">{{ lastText }}</text>
        <view v-if="conv.unreadCount" class="min-w-4 h-4 px-1 rounded-pill bg-danger flex items-center justify-center shrink-0">
          <text class="text-2xs text-white leading-none font-semibold">{{ conv.unreadCount > 99 ? "99+" : conv.unreadCount }}</text>
        </view>
      </view>
    </view>
  </view>
</template>

<script>
import OimAvatar from "@/components/oim-avatar.vue";
import { fromNow } from "@/utils/format";

/**
 * 会话列表的一行。
 * 时间用相对时间（刚刚/12 分钟前），未读角标与群标记都在这里，页面只管列表与搜索。
 */
export default {
  name: "ConvRow",
  components: { OimAvatar },
  props: {
    conv: { type: Object, required: true },
  },
  emits: ["open"],
  computed: {
    lastMsg() {
      return this.conv.lastMessage || {};
    },
    lastText() {
      const m = this.lastMsg || {};
      // mock 里是 { text }，OpenIM 里是 { content: { text } }，两种都要认
      const raw = m.text != null ? m.text : m.content && m.content.text;
      const text = typeof raw === "string" ? raw : "";
      if (!text) return "";
      const prefix = this.conv.isGroup && (m.senderNickname || m.senderName) ? `${m.senderNickname || m.senderName}：` : "";
      return `${prefix}${text}`;
    },
    timeText() {
      return this.lastMsg.sendTime ? fromNow(this.lastMsg.sendTime) : "";
    },
  },
};
</script>
