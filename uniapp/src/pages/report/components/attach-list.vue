<template>
  <view v-if="list.length" class="mt-2.5">
    <view v-for="a in list" :key="a.uid" class="flex items-center gap-2.5 py-2 border-b border-line">
      <view class="w-10 h-10 rounded-ctl bg-fill-2 flex items-center justify-center overflow-hidden shrink-0" @tap="$emit('preview', a)">
        <image v-if="a.thumb" :src="a.thumb" class="w-full h-full" mode="aspectFill" />
        <app-icon v-else :name="a.uploading ? 'refresh' : 'document'" :size="18" tone="ink-3" />
      </view>

      <view class="flex-1 min-w-0 flex flex-col gap-0.5">
        <text class="text-sm text-ink overflow-hidden whitespace-nowrap" style="text-overflow: ellipsis">{{ a.name }}</text>
        <text class="text-2xs text-ink-4">{{ a.uploading ? "上传中…" : sizeText(a.size) }}</text>
      </view>

      <view v-if="!locked" class="p-1" @tap="$emit('remove', a.uid)">
        <app-icon name="close" :size="14" tone="ink-4" />
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import { formatFileSize } from "@/api/oa";

/** 附件列表（日报与其它表单共用）：只渲染，增删由父级决定 */
export default {
  name: "AttachList",
  components: { AppIcon },
  props: {
    list: { type: Array, default: () => [] },
    locked: { type: Boolean, default: false },
  },
  emits: ["remove", "preview"],
  methods: {
    sizeText(size) {
      return formatFileSize(size);
    },
  },
};
</script>
