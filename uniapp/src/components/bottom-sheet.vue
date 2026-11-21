<template>
  <view v-if="open" class="bs-mask" @tap="close">
    <view class="bs" :class="{ 'bs--tall': tall }" @tap.stop>
      <view class="bs__head">
        <text class="bs__title">{{ title }}</text>
        <view class="bs__close" @tap="close">
          <app-icon name="close" :size="18" color="var(--ink-3)" />
        </view>
      </view>
      <text v-if="desc" class="bs__desc">{{ desc }}</text>

      <scroll-view class="bs__body" scroll-y :style="{ maxHeight: bodyMaxHeight }">
        <slot />
      </scroll-view>

      <view v-if="$slots.actions" class="bs__actions">
        <slot name="actions" />
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 底部弹层（遮罩 + 面板 + 标题 + 内容 + 操作区）。
 *
 * 原来每个页面各写一份 `.sheet-mask/.sheet/.sheet__ops`，四份 CSS 还各有出入
 * （圆角、安全区、最大高度）。统一到这里，页面只写内容与按钮。
 * 用法：
 *   <bottom-sheet :open="open" title="申请请假" @close="open = false">
 *     <form-field .../>
 *     <template #actions>
 *       <view class="bs-btn" @tap="submit">提交</view>
 *     </template>
 *   </bottom-sheet>
 */
export default {
  name: "BottomSheet",
  components: { AppIcon },
  props: {
    open: { type: Boolean, default: false },
    title: { type: String, default: "" },
    desc: { type: String, default: "" },
    tall: { type: Boolean, default: false },
  },
  emits: ["close"],
  computed: {
    bodyMaxHeight() {
      return this.tall ? "70vh" : "58vh";
    },
  },
  methods: {
    close() {
      this.$emit("close");
    },
  },
};
</script>

<style scoped>
.bs-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  z-index: 50;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.bs {
  width: 100%;
  max-width: 480px;
  background: #fff;
  border-radius: 16px 16px 0 0;
  padding: 16px 14px calc(14px + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.bs__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.bs__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--ink);
}

.bs__close {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: -8px;
}

.bs__desc {
  display: block;
  font-size: 11px;
  color: var(--ink-3);
  line-height: 1.6;
  margin-bottom: 10px;
}

.bs__body {
  max-width: 100%;
}

.bs__actions {
  display: flex;
  gap: 10px;
  margin-top: 14px;
}
</style>
