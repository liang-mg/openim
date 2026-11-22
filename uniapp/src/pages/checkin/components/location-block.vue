<template>
  <view class="mt-3.5 pt-3 border-t border-solid border-line">
    <view class="flex items-center gap-1.5">
      <app-icon name="location" :size="14" color="var(--ink-2)" />
      <text class="loc__name text-base font-semibold text-ink">{{ officeName }}</text>
      <view class="ml-auto px-1.5 py-0.5 rounded" :class="tagBg">
        <text class="text-2xs" :style="{ color: fenceColor }">{{ fenceText }}</text>
      </view>
    </view>

    <view v-if="locStatus === 'locating'" class="mt-1.5">
      <text class="text-sm text-ink-2 leading-normal">正在获取当前位置…</text>
    </view>

    <view v-else-if="locStatus === 'error'" class="mt-1.5">
      <text class="text-sm text-ink-2 leading-normal">{{ locMessage }}</text>
      <view class="loc__actions">
        <text class="text-sm text-brand" @tap="$emit('relocate')">重新定位</text>
        <text v-if="needSetting" class="text-sm text-warn-text" @tap="$emit('open-settings')">去开启定位权限</text>
      </view>
    </view>

    <view v-else-if="locStatus === 'ok'" class="mt-1.5">
      <text class="text-sm text-ink-2 leading-normal">{{ locSubText }}</text>
      <text v-if="locSource === 'ip'" class="block mt-1 text-xs text-warn-text">GPS 不可用，已按网络位置估算（精度较低）</text>
      <text class="block mt-1 text-xs text-ink-3">
        {{ locMeta }} · <text class="text-sm text-brand ml-1.5" @tap="$emit('relocate')">重新定位</text>
      </text>
    </view>

    <!-- 规则允许不强制定位时说明清楚，别让人以为定位坏了 -->
    <text v-if="!needLocation" class="block mt-1.5 text-xs text-ink-3">
      本规则允许不提供定位 · <text class="text-brand" @tap="$emit('relocate')">获取定位</text>
    </text>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import { fmtDistance } from "@/utils/checkin";

/**
 * 定位块：打卡点名称 + 范围标签 + 坐标/距离 + 重新定位。
 *
 * 只渲染页面已拿到的定位结果（locData/locStatus/locMessage），
 * uni.getLocation 与 locateCheckin 都由页面调，组件只抛 relocate。
 * 保留 .loc__name 类名（打卡点名称）。
 */
export default {
  name: "CheckinLocationBlock",
  components: { AppIcon },
  props: {
    locData: { type: Object, default: null },
    locStatus: { type: String, default: "idle" },
    locMessage: { type: String, default: "" },
    /** gps = 真定位；ip = GPS 失败后按网络位置兜底 */
    locSource: { type: String, default: "gps" },
    /** 规则是否要求定位；false 时提示「本规则允许不提供定位」，与 PC 文案一致 */
    needLocation: { type: Boolean, default: true },
    todayOffice: { type: Object, default: null },
    /** 未授权/系统定位关闭时，显示「去开启定位权限」入口 */
    needSetting: { type: Boolean, default: false },
  },
  emits: ["relocate", "open-settings"],
  computed: {
    officeName() {
      if (this.locStatus === "ok" && this.locData && this.locData.office) return this.locData.office.name;
      if (this.todayOffice && this.todayOffice.name) return this.todayOffice.name;
      return "当前位置";
    },
    fenceText() {
      if (this.locStatus === "locating") return "定位中";
      if (this.locStatus === "error") return "未定位";
      if (this.locStatus !== "ok" || !this.locData) return "";
      // 没配打卡点就没有「范围」可言，别硬造一个「正常」出来
      if (!this.locData.fence_set) return "已定位";
      return this.locData.in_fence ? "打卡范围内" : "超出打卡范围";
    },
    fenceColor() {
      if (this.locStatus === "error") return "var(--danger)";
      if (this.locStatus !== "ok" || !this.locData) return "var(--sub-text)";
      if (!this.locData.fence_set) return "var(--primary)";
      return this.locData.in_fence ? "var(--ok-text)" : "var(--warn-strong)";
    },
    tagBg() {
      if (this.locStatus === "error") return "bg-danger-soft";
      if (this.locStatus !== "ok" || !this.locData) return "bg-fill-2";
      if (!this.locData.fence_set) return "bg-brand-soft";
      return this.locData.in_fence ? "bg-ok-soft" : "bg-warn-soft";
    },
    locSubText() {
      if (!this.locData) return "";
      const d = this.locData;
      const base = d.fence_set ? `距打卡点 ${fmtDistance(d.distance)}` : "已记录当前坐标";
      return d.address ? `${base} · ${d.address}` : base;
    },
    locMeta() {
      if (!this.locData) return "";
      return `${Number(this.locData.lat).toFixed(5)}, ${Number(this.locData.lng).toFixed(5)}`;
    },
  },
};
</script>

<style scoped>
.loc__actions {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-top: 6px;
}
</style>
