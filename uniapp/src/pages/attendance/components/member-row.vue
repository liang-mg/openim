<template>
  <view class="member-row flex items-center gap-2.5 rounded-card bg-white px-3 py-3 mb-2.5" @tap="$emit('open', member)">
    <oim-avatar :text="(member.name || '?').slice(0, 1)" :size="40" />

    <view class="flex-1 min-w-0">
      <view class="flex items-center gap-1.5">
        <text class="text-md font-semibold text-ink">{{ member.name }}</text>
        <view v-if="member.exception" class="w-1.5 h-1.5 rounded-pill bg-danger" />
        <text class="ml-auto text-xs" :style="{ color: todayColor }">{{ todayText }}</text>
      </view>

      <text class="block mt-0.5 text-xs text-ink-3">
        {{ member.department || "未分配" }}{{ member.position ? ` · ${member.position}` : "" }}
      </text>

      <view class="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1">
        <text class="text-xs text-ink-2">出勤 {{ member.month.attend }}/{{ member.month.workdays }}</text>
        <text class="text-xs text-warn-text">迟到 {{ member.month.late }}</text>
        <text class="text-xs text-danger">缺卡 {{ member.month.absent }}</text>
        <text class="text-xs text-ink-2">出勤率 {{ member.month.rate }}%</text>
      </view>
    </view>

    <app-icon name="chevron-right" :size="15" tone="ink-4" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";

const TODAY_TEXT = { done: "已打卡", partial: "缺一次卡", absent: "未打卡", leave: "已批准请假", in_progress: "上班中", rest: "休息", not_yet: "未到点" };
const TODAY_COLOR = {
  done: "var(--ok-text)",
  partial: "var(--warn-strong)",
  absent: "var(--danger)",
  leave: "var(--ok-text)",
  in_progress: "var(--primary)",
  rest: "var(--sub-text)",
  not_yet: "var(--sub-text)",
};

/** 团队出勤：一个成员一行（今日状态 + 本月统计） */
export default {
  name: "MemberRow",
  components: { AppIcon, OimAvatar },
  props: {
    member: { type: Object, required: true },
  },
  emits: ["open"],
  computed: {
    todayText() {
      const state = (this.member.today || {}).state;
      return TODAY_TEXT[state] || "";
    },
    todayColor() {
      const state = (this.member.today || {}).state;
      return TODAY_COLOR[state] || "var(--sub-text)";
    },
  },
};
</script>
