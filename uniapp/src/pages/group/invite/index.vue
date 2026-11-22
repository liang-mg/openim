<template>
  <view class="app-page">
    <page-header title="邀请好友">
      <template #right><text class="gi-count">已选 {{ selected.length }} 人</text></template>
    </page-header>

    <view class="px-3 pt-3 pb-24">
      <view v-if="loading" class="oa-card"><skeleton :lines="5" :height="16" /></view>
      <empty-state v-else-if="error" :text="error" name="users" />
      <empty-state v-else-if="!candidates.length" text="没有可邀请的好友（可能都已在群里）" name="users" />

      <view v-else class="oa-card gi-list">
        <view v-for="f in candidates" :key="f.userID" class="gi-row" @tap="toggle(f)">
          <view class="gi-check" :class="{ 'gi-check--on': selected.includes(f.userID) }">
            <app-icon v-if="selected.includes(f.userID)" name="check" :size="12" color="#ffffff" />
          </view>
          <oim-avatar :text="(f.remark || f.nickname || '?').slice(0, 1)" :size="40" />
          <view class="gi-main">
            <text class="gi-name">{{ f.remark || f.nickname || f.userID }}</text>
            <text class="gi-sub">用户ID：{{ f.userID }}</text>
          </view>
        </view>
      </view>
    </view>

    <view class="gi-footer">
      <view class="gi-invite" :class="{ 'opacity-50': inviting }" @tap="invite"><text class="gi-invite-text">{{ inviting ? "邀请中…" : "邀请入群" }}</text></view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import Skeleton from "@/components/skeleton.vue";
import { listFriends, getGroupMembers, inviteGroupMembers, connect } from "@/api/im";

/** 邀请好友入群：排除已在群里的成员。 */
export default {
  components: { PageHeader, AppIcon, OimAvatar, EmptyState, Skeleton },
  data() {
    return {
      groupID: "",
      friends: [],
      memberIDs: [],
      selected: [],
      loading: true,
      error: "",
      inviting: false,
    };
  },
  computed: {
    candidates() {
      return this.friends.filter((f) => !this.memberIDs.includes(f.userID));
    },
  },
  onLoad(options) {
    this.groupID = decodeURIComponent(options.groupID || "");
    this.load();
  },
  methods: {
    async load() {
      if (!this.groupID) {
        this.error = "缺少群ID";
        this.loading = false;
        return;
      }
      this.loading = true;
      this.error = "";
      try {
        await connect();
        const [friends, members] = await Promise.all([
          listFriends(),
          getGroupMembers(this.groupID, { count: 200 }).catch(() => []),
        ]);
        this.friends = friends;
        this.memberIDs = members.map((m) => m.userID);
      } catch (e) {
        this.error = e.message || "加载失败";
      } finally {
        this.loading = false;
      }
    },
    toggle(f) {
      const idx = this.selected.indexOf(f.userID);
      if (idx >= 0) this.selected.splice(idx, 1);
      else this.selected.push(f.userID);
    },
    async invite() {
      if (this.inviting) return;
      if (!this.selected.length) {
        uni.showToast({ title: "请选择好友", icon: "none" });
        return;
      }
      this.inviting = true;
      try {
        await inviteGroupMembers({ groupID: this.groupID, userIDs: this.selected });
        uni.showToast({ title: "已发送邀请", icon: "none" });
        setTimeout(() => uni.navigateBack(), 500);
      } catch (e) {
        uni.showToast({ title: e.message || "邀请失败", icon: "none" });
      } finally {
        this.inviting = false;
      }
    },
  },
};
</script>

<style scoped>
.gi-count {
  font-size: 12px;
  color: #fff;
  opacity: 0.9;
}

.gi-list {
  padding: 0;
  overflow: hidden;
}

.gi-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--line);
}

.gi-row:last-child {
  border-bottom: none;
}

.gi-check {
  width: 20px;
  height: 20px;
  border-radius: 10px;
  border: 1px solid var(--line-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.gi-check--on {
  background: var(--brand);
  border-color: var(--brand);
}

.gi-check-text {
  color: #fff;
  font-size: 12px;
  line-height: 1;
}

.gi-main {
  flex: 1;
  min-width: 0;
}

.gi-name {
  font-size: 14px;
  color: var(--ink);
  font-weight: 500;
}

.gi-sub {
  display: block;
  margin-top: 2px;
  font-size: 10px;
  color: var(--ink-4);
}

.gi-footer {
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

.gi-invite {
  height: 44px;
  border-radius: 10px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.gi-invite-text {
  color: #fff;
  font-size: 15px;
  font-weight: 500;
}
</style>
