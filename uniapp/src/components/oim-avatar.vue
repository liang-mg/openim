<template>
  <view class="avatar" :style="boxStyle">
    <image v-if="src" :src="src" class="avatar__img" mode="aspectFill" />
    <text v-else class="avatar__text" :style="{ fontSize: textSize }">{{ text || "?" }}</text>
  </view>
</template>

<script>
/**
 * 头像：有图显示图，没图用姓名首字兜底。
 * 对应 PC 端 frontend/src/components/OIMAvatar。
 */
export default {
  name: "OimAvatar",
  props: {
    src: { type: String, default: "" },
    text: { type: String, default: "" },
    size: { type: Number, default: 40 },
  },
  computed: {
    boxStyle() {
      return { width: `${this.size}px`, height: `${this.size}px` };
    },
    textSize() {
      return `${Math.max(12, Math.round(this.size * 0.42))}px`;
    },
  },
};
</script>

<style scoped>
.avatar {
  flex: 0 0 auto;
  border-radius: 50%;
  overflow: hidden;
  background: var(--brand-soft);
  display: flex;
  align-items: center;
  justify-content: center;
}

.avatar__img {
  width: 100%;
  height: 100%;
}

.avatar__text {
  color: var(--brand);
  font-weight: 600;
  line-height: 1;
}
</style>
