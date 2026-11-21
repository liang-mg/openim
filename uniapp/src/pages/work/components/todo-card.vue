<template>
  <view class="todo oa-card">
    <view class="todo__head flex items-center gap-1.5 mb-1.5">
      <text class="todo__title text-lg font-semibold text-ink">待办</text>
      <view v-if="todos.length" class="todo__badge flex items-center justify-center min-w-4 h-4 px-1.5 box-border rounded-pill bg-danger">
        <text class="todo__badge-text text-white text-2xs font-semibold leading-none tabular-nums">{{ todos.length }}</text>
      </view>
    </view>

    <view v-if="!todos.length" class="todo__empty flex items-center gap-2 pt-3.5 pb-1 border-t border-solid border-line">
      <app-icon name="check" :size="15" color="var(--ok-text)" />
      <text class="todo__empty-text text-base text-ink-3">{{ emptyText }}</text>
    </view>

    <view
      v-for="todo in todos"
      :key="`${todo.key}-${todo.text}`"
      class="todo__row flex items-center justify-between gap-2 py-2.5 border-t border-solid border-line"
      @tap="$emit('open', todo.path)"
    >
      <view class="todo__row-left flex items-center min-w-0">
        <view class="todo__dot w-1.5 h-1.5 rounded-full mr-2 shrink-0" :style="{ background: todo.dot }" />
        <text class="todo__row-text text-base text-ink">{{ todo.text }}</text>
      </view>
      <view class="todo__action flex items-center gap-px whitespace-nowrap">
        <text class="todo__action-text text-sm text-brand">{{ todo.action }}</text>
        <app-icon name="chevron-right" :size="13" color="var(--brand)" />
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 工作台待办卡：标题 + 数量徽标 + 空态 + 待办行。
 *
 * 点了哪条待办只把后端给的 path 抛给页面（PC web 路由 → uni 页面的映射在页面做），
 * 空态文案依赖「日报是否已提交 / 是否漏下班卡」，由页面把这两份数据传进来组合。
 */
export default {
  name: "TodoCard",
  components: { AppIcon },
  props: {
    todos: { type: Array, default: () => [] },
    report: { type: Object, default: () => ({ submitted: false }) },
    checkin: { type: Object, default: () => ({}) },
  },
  emits: ["open"],
  computed: {
    emptyText() {
      const base = this.report.submitted ? "今天的日报已提交" : "今天没有待办";
      const tail = this.checkin.has_on && !this.checkin.has_off ? " · 记得下班打卡" : "";
      return `${base}${tail}`;
    },
  },
};
</script>
