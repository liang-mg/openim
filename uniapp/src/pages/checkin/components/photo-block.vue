<template>
  <view>
    <text class="block text-lg font-semibold mb-3">现场拍照</text>

    <view
      class="photo w-full h-[220px] border border-dashed border-[var(--line-2)] rounded-[10px] bg-fill flex items-center justify-center overflow-hidden"
      @tap="$emit('take')"
    >
      <image v-if="photo" class="photo__img w-full h-full" :src="photo" mode="aspectFill" />
      <view v-else class="flex flex-col items-center gap-2">
        <app-icon name="camera" :size="34" color="var(--sub-text)" />
        <text class="text-base text-[var(--sub-text)]">{{ photoError ? "摄像头不可用" : "点击拍照" }}</text>
      </view>
    </view>

    <view class="flex gap-2.5 mt-3">
      <view
        class="flex-1 h-[42px] rounded-ctl flex items-center justify-center"
        :class="photo ? 'bg-brand' : 'bg-fill-2'"
        @tap="$emit('take')"
      >
        <text class="text-md" :class="photo ? 'text-white' : 'text-ink'">{{ photo ? "重新拍照" : "打开摄像头" }}</text>
      </view>
      <view v-if="photo" class="flex-1 h-[42px] rounded-ctl bg-fill-2 flex items-center justify-center" @tap="$emit('clear')">
        <text class="text-md text-ink">清除</text>
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";

/**
 * 现场拍照块：照片预览 / 占位 + 打开摄像头（重拍）/ 清除。
 *
 * 只展示 photo 并抛事件，真正的 uni.chooseImage + 水印合成留在页面：
 * 水印要用到时钟、定位与当前用户，属于页面编排。
 * 保留 .photo / .photo__img 类名：E2E 用 `.photo` 触发 filechooser、
 * 用 `.photo__img` 断言预览已生成。
 */
export default {
  name: "CheckinPhotoBlock",
  components: { AppIcon },
  props: {
    photo: { type: String, default: "" },
    photoError: { type: Boolean, default: false },
  },
  emits: ["take", "clear"],
};
</script>
