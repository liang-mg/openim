<template>
  <view class="scope-switch flex bg-fill-2 rounded-ctl p-0.5">
    <view
      v-for="opt in options"
      :key="opt.value"
      class="px-3 py-1.5 rounded-md"
      :class="{ 'bg-white': value === opt.value }"
      @tap="pick(opt.value)"
    >
      <text class="text-sm" :class="value === opt.value ? 'text-brand font-semibold' : 'text-ink-2'">{{ opt.label }}</text>
    </view>
  </view>
</template>

<script>
/** 分段选项：与页面 scope 的取值一致 */
const OPTIONS = [
  { label: "我的团队", value: "team" },
  { label: "全公司", value: "all" },
];

/**
 * 团队 / 全公司分段控件（团队出勤与出勤报表两处共用）。
 * 只受控：value 从页面来，点击回抛 update，切档后的取数由页面负责。
 */
export default {
  name: "ScopeSwitch",
  props: {
    value: { type: String, default: "team" },
  },
  emits: ["update"],
  computed: {
    options() {
      return OPTIONS;
    },
  },
  methods: {
    pick(next) {
      if (next !== this.value) this.$emit("update", next);
    },
  },
};
</script>
