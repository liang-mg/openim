<template>
  <view class="sk" :class="{ 'sk--inline': inline }">
    <view
      v-for="i in lines"
      :key="i"
      class="sk__line"
      :style="{
        width: i === lines && lines > 1 ? '60%' : '100%',
        height: height + 'px',
        borderRadius: radius,
      }"
    />
  </view>
</template>

<script>
/**
 * 骨架屏占位。
 *
 * 为什么需要：首开（缓存未命中）时页面是空白的，用户会以为「点了没反应」。
 * 先渲染与真实布局同构的灰块，数据回来再替换，感知上快很多。
 *
 * 用法：
 *   <skeleton :lines="3" :height="16" />          列表占位
 *   <skeleton :lines="1" :height="72" :radius="'12px'" />  卡片占位
 */
export default {
  name: "Skeleton",
  props: {
    lines: { type: Number, default: 3 },
    height: { type: [Number, String], default: 14 },
    radius: { type: String, default: "6px" },
    inline: { type: Boolean, default: false },
  },
};
</script>

<style scoped>
.sk {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 0;
}

.sk--inline {
  padding: 0;
}

.sk__line {
  background: linear-gradient(90deg, #f0f2f5 25%, #f7f8fa 37%, #f0f2f5 63%);
  background-size: 400% 100%;
  animation: sk-shimmer 1.4s ease infinite;
}

@keyframes sk-shimmer {
  0% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0 50%;
  }
}
</style>
