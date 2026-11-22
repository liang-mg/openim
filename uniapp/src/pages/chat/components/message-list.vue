<template>
  <scroll-view
    class="flex-1 min-h-0 bg-page"
    scroll-y
    :scroll-into-view="anchor"
    :scroll-with-animation="false"
    @scroll="$emit('scroll', $event)"
  >
    <view class="px-3 pt-2.5 pb-1">
      <template v-if="messages.length">
        <view v-if="hasMore" class="flex justify-center pt-1.5 pb-2.5" @tap="$emit('load-more')">
          <text class="text-2xs text-ink-4">{{ loadingMore ? "加载中…" : "查看更早的消息" }}</text>
        </view>
        <view v-else class="flex justify-center pt-1.5 pb-2.5 opacity-70">
          <text class="text-2xs text-ink-4">没有更早的消息了</text>
        </view>
      </template>
      <empty-state v-else :text="emptyText" name="message" />

      <view v-for="group in grouped" :key="group.key">
        <!-- 微信式时间线：时间条居中，只在相邻消息间隔超过 5 分钟处出现 -->
        <view class="chat__time flex justify-center pt-2.5 pb-1.5">
          <text class="chat__time-text text-2xs text-ink-3 bg-black/5 rounded-md px-2 py-0.5">{{ group.label }}</text>
        </view>

        <view v-for="(m, idx) in group.items" :key="m.clientMsgID">
          <view v-if="m.system" class="chat__system flex justify-center py-1.5" :id="`m_${m.clientMsgID}`">
            <text class="chat__system-text text-2xs text-ink-3 bg-black/5 rounded-md px-2 py-0.5">{{ m.text }}</text>
          </view>
          <view
            v-else
            :id="`m_${m.clientMsgID}`"
            class="row flex items-start gap-2"
            :class="rowClass(group.items, idx)"
          >
          <oim-avatar v-if="!m.isSelf && showHead(group.items, idx)" :text="(m.senderName || '?').slice(0, 1)" :size="34" />
          <view v-else-if="!m.isSelf" class="row__pad w-[34px] shrink-0" />

          <view class="max-w-[72%] flex flex-col" :class="m.isSelf ? 'items-end' : 'items-start'">
            <text v-if="!m.isSelf && isGroup && showHead(group.items, idx)" class="row__name text-2xs text-ink-4 mb-1">{{ m.senderName }}</text>
            <view class="bubble px-3 py-[9px] rounded-[10px]" :class="bubbleClass(m)">
              <text class="bubble__text text-md text-ink leading-normal break-all">{{ m.text }}</text>
            </view>
            <text v-if="m.status === 'failed'" class="row__retry text-2xs text-danger mt-1" @tap="$emit('retry', m)">发送失败，点击重发</text>
            <text v-if="m.status === 'failed' && m.error" class="row__error text-2xs text-ink-4 mt-0.5">{{ m.error }}</text>
            <text v-else-if="m.isSelf && m.status === 'sending'" class="row__status text-2xs text-ink-4 mt-1">发送中…</text>
          </view>

            <oim-avatar v-if="m.isSelf && showHead(group.items, idx)" :text="selfText" :size="34" />
            <view v-else-if="m.isSelf" class="row__pad w-[34px] shrink-0" />
          </view>
        </view>
      </view>

      <view id="chat_bottom" class="h-2" />
    </view>
  </scroll-view>
</template>

<script>
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import { bjHM, bjYmd } from "@/utils/beijing";

const GAP = 5 * 60 * 1000; // 超过 5 分钟插一条时间条

/** 时间条文案：今天只显示 HH:mm，更早显示 MM-DD HH:mm（一律北京时间） */
function stamp(ts) {
  const hm = bjHM(ts);
  if (bjYmd(ts) === bjYmd(Date.now())) return hm;
  return `${bjYmd(ts).slice(5)} ${hm}`;
}

/**
 * 消息区：时间条分组 + 连续同一人只显示一次头像/昵称 + 加载更多 + 空态 + 发送中/失败重发。
 * 时间线逻辑（分组、时间文案、showHead）都在本文件，页面只传原始 messages 与滚动锚点。
 */
export default {
  name: "MessageList",
  components: { OimAvatar, EmptyState },
  props: {
    messages: { type: Array, default: () => [] },
    selfText: { type: String, default: "我" },
    isGroup: { type: Boolean, default: false },
    connState: { type: String, default: "idle" },
    hasMore: { type: Boolean, default: false },
    loadingMore: { type: Boolean, default: false },
    anchor: { type: String, default: "" },
  },
  emits: ["load-more", "retry", "scroll"],
  computed: {
    emptyText() {
      return this.connState === "connecting" ? "正在连接 IM…" : "还没有消息，打个招呼吧";
    },
    /** 按 5 分钟间隔分组，组头放时间条 */
    grouped() {
      const groups = [];
      let current = null;
      this.messages.forEach((m) => {
        if (!current || m.sendTime - current.last > GAP) {
          current = { key: `g_${m.clientMsgID}`, label: stamp(m.sendTime), last: m.sendTime, items: [] };
          groups.push(current);
        }
        current.items.push(m);
        current.last = m.sendTime;
      });
      return groups;
    },
  },
  methods: {
    /** 同一组里连续同一个人发消息时，只有第一条显示头像/昵称 */
    showHead(items, idx) {
      return !this.isTight(items, idx);
    },
    /** 与上一条是同一人：收紧 4px 间距（跨人/跨组保持 12px） */
    isTight(items, idx) {
      return idx > 0 && Boolean(items[idx - 1].isSelf) === Boolean(items[idx].isSelf);
    },
    rowClass(items, idx) {
      const tight = this.isTight(items, idx);
      const self = items[idx].isSelf;
      // 自己的消息靠右：少了 justify-end 的话气泡会贴到左边（头像反而在右，视觉是错的）
      return [
        { "row--self": self, "row--tight": tight, "justify-end": self },
        tight ? "mb-1" : "mb-3",
      ];
    },
    bubbleClass(m) {
      const failed = m.status === "failed";
      return {
        "bubble--self": m.isSelf,
        "bubble--sending": m.status === "sending",
        "bubble--failed": failed,
        "bg-white": !m.isSelf && !failed,
        "bg-brand-soft": m.isSelf && !failed,
        "bg-danger-soft": failed,
        "rounded-tl-[3px]": !m.isSelf,
        "rounded-tr-[3px]": m.isSelf,
        "opacity-60": m.status === "sending",
      };
    },
  },
};
</script>
