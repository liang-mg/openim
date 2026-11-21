<template>
  <view class="person-row flex items-center gap-3 px-3.5 py-3 bg-white border-b border-line" @tap="$emit('open', item)">
    <oim-avatar :text="(item.name || '?').slice(0, 1)" :size="42" />

    <view class="flex-1 min-w-0">
      <view class="flex items-center gap-1.5">
        <text class="text-md text-ink">{{ item.name }}</text>
        <text v-if="item.online" class="text-2xs text-ok-text">在线</text>
      </view>
      <text class="block mt-0.5 text-sm text-ink-3 overflow-hidden whitespace-nowrap" style="text-overflow: ellipsis">{{ item.sub }}</text>
    </view>

    <app-icon name="chevron-right" :size="15" tone="ink-4" />
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";

/** 通讯录的一行（好友或群） */
export default {
  name: "PersonRow",
  components: { AppIcon, OimAvatar },
  props: {
    item: { type: Object, required: true },
  },
  emits: ["open"],
};
</script>
