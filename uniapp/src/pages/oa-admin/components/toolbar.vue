<template>
  <view>
    <view class="toolbar flex gap-2 mb-2">
      <input
        class="toolbar__search flex-1 h-9 px-3 rounded-ctl bg-white text-sm text-ink"
        :value="keyword"
        placeholder="搜索姓名、部门或岗位"
        placeholder-class="text-ink-4"
        confirm-type="search"
        @input="$emit('update:keyword', $event.detail.value)"
        @confirm="$emit('search')"
      />
      <picker mode="selector" :range="deptOptions" :value="deptIndex" @change="onDeptChange">
        <view class="toolbar__filter h-9 leading-9 px-2.5 rounded-ctl bg-white text-xs text-ink-2 whitespace-nowrap">
          {{ deptFilter || "部门：全部" }}
        </view>
      </picker>
      <picker mode="selector" :range="roleLabels" :value="roleIndex" @change="onRoleChange">
        <view class="toolbar__filter h-9 leading-9 px-2.5 rounded-ctl bg-white text-xs text-ink-2 whitespace-nowrap">
          {{ roleFilterText }}
        </view>
      </picker>
    </view>

    <view class="toolbar2 flex items-center gap-2 mb-2.5 px-0.5">
      <text class="text-xs text-ink-2">含已停用</text>
      <toggle-switch small :on="includeDisabled" @change="$emit('toggle-disabled')" />
      <text class="ml-auto text-xs text-ink-4">共 {{ count }} 人</text>
    </view>
  </view>
</template>

<script>
import ToggleSwitch from "./toggle-switch.vue";

/**
 * 员工列表筛选条：搜索框 + 部门/角色 picker + 「含已停用」+ 人数。
 *
 * 保留 .toolbar / .toolbar__search / .toolbar__filter / .toolbar2 类名：
 * E2E 用 `.toolbar uni-picker` 点部门筛选、用 `.toolbar__search input` 输入关键词、
 * 用 `.toolbar2 .switch` 切「含已停用」。
 * 组件只抛事件，取数（load）始终由页面做。
 */
export default {
  name: "AdminToolbar",
  components: { ToggleSwitch },
  props: {
    keyword: { type: String, default: "" },
    deptOptions: { type: Array, default: () => [] },
    deptIndex: { type: Number, default: 0 },
    deptFilter: { type: String, default: "" },
    roleLabels: { type: Array, default: () => [] },
    roleIndex: { type: Number, default: 0 },
    roleFilterText: { type: String, default: "角色：全部" },
    includeDisabled: { type: Boolean, default: false },
    count: { type: Number, default: 0 },
  },
  emits: ["update:keyword", "search", "dept-change", "role-change", "toggle-disabled"],
  methods: {
    onDeptChange(e) {
      this.$emit("dept-change", Number(e.detail.value));
    },
    onRoleChange(e) {
      this.$emit("role-change", Number(e.detail.value));
    },
  },
};
</script>
