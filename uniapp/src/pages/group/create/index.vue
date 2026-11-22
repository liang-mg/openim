<template>
  <view class="app-page">
    <page-header title="创建群聊">
      <template #right>
        <text class="gc-count">已选 {{ selected.length }} 人</text>
      </template>
    </page-header>

    <view class="px-3 pt-3 pb-24">
      <view class="oa-card">
        <text class="gc-label">群名称</text>
        <input v-model="groupName" class="gc-input" maxlength="24" placeholder="给群起个名字" placeholder-class="gc-ph" />
      </view>

      <view class="gc-section-title">选择群成员</view>
      <view v-if="loading" class="oa-card"><skeleton :lines="5" :height="16" /></view>
      <empty-state v-else-if="error" :text="error" name="users" />
      <empty-state v-else-if="!friends.length" text="还没有好友，先去添加好友" name="users" />
      <view v-else class="oa-card gc-list">
        <view v-for="f in friends" :key="f.userID" class="gc-row" @tap="toggle(f)">
          <view class="gc-check" :class="{ 'gc-check--on': selected.includes(f.userID) }">
            <app-icon v-if="selected.includes(f.userID)" name="check" :size="12" color="#ffffff" />
          </view>
          <oim-avatar :text="(f.remark || f.nickname || '?').slice(0, 1)" :size="40" />
          <view class="gc-main">
            <text class="gc-name">{{ f.remark || f.nickname || f.userID }}</text>
            <text class="gc-sub">用户ID：{{ f.userID }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="gc-footer">
      <view class="gc-create" :class="{ 'opacity-50': creating }" @tap="create"><text class="gc-create-text">{{ creating ? "创建中…" : "创建群聊" }}</text></view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import { listFriends, createGroup, getOrCreateConversation, connect } from "@/api/im";

/** 创建群聊：选好友 + 群名。创建后直接进群会话。 */
export default {
  components: { PageHeader, AppIcon, OimAvatar, EmptyState, Skeleton },
  data() {
    return {
      groupName: "",
      friends: [],
      selected: [],
      loading: true,
      error: "",
      creating: false,
    };
  },
  onShow() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      this.error = "";
      try {
        await connect();
        this.friends = await listFriends();
      } catch (e) {
        this.error = e.message || "好友加载失败";
      } finally {
        this.loading = false;
      }
    },
    toggle(f) {
      const idx = this.selected.indexOf(f.userID);
      if (idx >= 0) this.selected.splice(idx, 1);
      else this.selected.push(f.userID);
    },
    async create() {
      if (this.creating) return;
      const name = String(this.groupName || "").trim();
      if (!name) {
        uni.showToast({ title: "请输入群名称", icon: "none" });
        return;
      }
      if (!this.selected.length) {
        uni.showToast({ title: "请选择至少一位群成员", icon: "none" });
        return;
      }
      this.creating = true;
      try {
        const group = await createGroup({
          groupName: name,
          memberUserIDs: this.selected,
        });
        if (!group || !group.groupID) throw new Error("创建群失败");
        const conv = await getOrCreateConversation({ sourceID: group.groupID, sessionType: 3 });
        if (!conv || !conv.conversationID) throw new Error("群会话创建失败");
        uni.redirectTo({
          url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(group.groupName || name)}&group=1&members=${group.memberCount || this.selected.length + 1}`,
        });
      } catch (e) {
        uni.showToast({ title: e.message || "创建群失败", icon: "none" });
      } finally {
        this.creating = false;
      }
    },
  },
};
</script>

<style scoped>
.gc-count {
  font-size: 12px;
  color: #fff;
  opacity: 0.9;
}

.gc-label {
  display: block;
  font-size: 12px;
  color: var(--ink-3);
  margin-bottom: 6px;
}

.gc-input {
  height: 40px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 14px;
}

.gc-ph {
  color: var(--ink-4);
}

.gc-section-title {
  margin: 16px 2px 8px;
  font-size: 12px;
  color: var(--ink-3);
}

.gc-list {
  padding: 0;
  overflow: hidden;
}

.gc-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.gc-row:last-child {
  border-bottom: none;
}

.gc-check {
  width: 20px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--line-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gc-check--on {
  background: var(--brand);
  border-color: var(--brand);
}

.gc-check-text {
  color: #fff;
  font-size: 12px;
  line-height: 1;
}

.gc-main {
  flex: 1;
  min-width: 0;
}

.gc-name {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}

.gc-sub {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--ink-4);
}

.gc-footer {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  max-width: 480px;
  margin: 0 auto;
  padding: 10px 14px calc(10px + env(safe-area-inset-bottom));
  background: #fff;
  border-top: 1px solid var(--line);
}

.gc-create {
  height: 44px;
  border-radius: 10px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.gc-create-text {
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}
</style>
