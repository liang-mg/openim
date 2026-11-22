<template>
  <view class="app-page">
    <page-header title="添加好友" />

    <view class="px-3 pt-3 pb-7">
      <view class="af-search oa-card">
        <input v-model="keyword" class="af-input" placeholder="手机号 / 账号 / 用户ID" placeholder-class="af-ph" confirm-type="search" @confirm="search" />
        <view class="af-search-btn" @tap="search"><text class="af-search-text">{{ searching ? "搜索中" : "搜索" }}</text></view>
      </view>

      <view v-if="searched && !results.length && !searching" class="mt-4">
        <empty-state text="没有找到这个用户，确认手机号/用户ID是否正确" name="user" />
      </view>

      <view v-if="results.length" class="oa-card mt-3 af-results">
        <view v-for="u in results" :key="u.userID" class="af-row" :class="{ 'af-row--active': selected && selected.userID === u.userID }" @tap="select(u)">
          <oim-avatar :text="(u.nickname || '?').slice(0, 1)" :size="42" />
          <view class="af-main">
            <view class="flex items-center gap-2">
              <text class="af-name">{{ u.nickname || u.userID }}</text>
              <text v-if="u.userID === selfID" class="af-tag">自己</text>
              <text v-else-if="u.isFriend" class="af-tag af-tag--ok">已是好友</text>
            </view>
            <text class="af-sub">用户ID：{{ u.userID }}</text>
            <text v-if="u.phoneNumber" class="af-sub">手机号：{{ u.phoneNumber }}</text>
          </view>
          <text class="af-arrow">›</text>
        </view>
      </view>

      <view v-if="selected" class="oa-card mt-3">
        <view class="flex items-center gap-3">
          <oim-avatar :text="(selected.nickname || '?').slice(0, 1)" :size="48" />
          <view class="flex-1 min-w-0">
            <text class="af-name">{{ selected.nickname || selected.userID }}</text>
            <text class="af-sub">用户ID：{{ selected.userID }}</text>
          </view>
        </view>

        <template v-if="selected.userID === selfID">
          <view class="af-hint">不能添加自己为好友</view>
        </template>
        <template v-else-if="selected.isFriend">
          <view class="af-primary mt-4" @tap="openChat(selected)"><text class="af-primary-text">发消息</text></view>
        </template>
        <template v-else>
          <text class="af-label">验证消息</text>
          <textarea v-model="reqMsg" class="af-textarea" maxlength="80" placeholder="你好，我是…" placeholder-class="af-ph" />
          <view class="af-primary mt-3" @tap="sendRequest"><text class="af-primary-text">{{ sending ? "发送中…" : "发送好友申请" }}</text></view>
        </template>
      </view>

      <view class="af-tip">对方通过后，会出现在「通讯录 → 好友」里；也可以让对方先加你。</view>
    </view>
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import EmptyState from "@/components/empty-state.vue";
import { searchUsers } from "@/api/im/users";
import { getUsersInfo, listFriends, addFriend, getOrCreateConversation } from "@/api/im";
import { getUserId } from "@/utils/storage";

/**
 * 添加好友：优先走 chat 搜索（手机号/昵称/账号），搜不到再按 userID 精确查。
 * 选人后填验证消息发送申请；已经是好友的直接进聊天。
 */
export default {
  components: { PageHeader, OimAvatar, EmptyState },
  data() {
    return {
      keyword: "",
      results: [],
      selected: null,
      searched: false,
      searching: false,
      sending: false,
      reqMsg: "你好，我是新博 OA 的同事",
      selfID: "",
      friendIDs: [],
    };
  },
  onLoad(options) {
    this.selfID = getUserId();
    if (options.keyword) {
      this.keyword = decodeURIComponent(options.keyword);
      this.search();
    }
  },
  methods: {
    async search() {
      const q = String(this.keyword || "").trim();
      if (!q) {
        uni.showToast({ title: "请输入手机号/账号/用户ID", icon: "none" });
        return;
      }
      if (this.searching) return;
      this.searching = true;
      this.searched = false;
      this.selected = null;
      try {
        if (!this.friendIDs.length) {
          try {
            this.friendIDs = (await listFriends()).map((f) => f.userID);
          } catch (e) {
            this.friendIDs = [];
          }
        }
        let users = [];
        try {
          users = await searchUsers(q);
        } catch (e) {
          users = [];
        }
        if (!users.length) {
          try {
            users = await getUsersInfo([q]);
          } catch (e) {
            users = [];
          }
        }
        const seen = new Set();
        this.results = users
          .filter((u) => u && u.userID && !seen.has(u.userID) && seen.add(u.userID))
          .map((u) => ({ ...u, isFriend: this.friendIDs.includes(u.userID) }));
        this.searched = true;
        if (this.results.length === 1) this.select(this.results[0]);
      } catch (e) {
        uni.showToast({ title: e.message || "搜索失败", icon: "none" });
      } finally {
        this.searching = false;
      }
    },
    select(u) {
      this.selected = u;
      this.reqMsg = this.reqMsg || "你好，我是新博 OA 的同事";
    },
    async sendRequest() {
      if (!this.selected || this.sending) return;
      this.sending = true;
      try {
        await addFriend({
          toUserID: this.selected.userID,
          reqMsg: String(this.reqMsg || "").trim() || "你好",
        });
        uni.showToast({ title: "好友申请已发送", icon: "none" });
        this.selected = null;
      } catch (e) {
        uni.showToast({ title: e.message || "发送申请失败", icon: "none" });
      } finally {
        this.sending = false;
      }
    },
    async openChat(u) {
      try {
        const conv = await getOrCreateConversation({ sourceID: u.userID, sessionType: 1 });
        if (!conv || !conv.conversationID) throw new Error("会话创建失败");
        uni.navigateTo({
          url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(u.nickname || u.userID)}&group=0`,
        });
      } catch (e) {
        uni.showToast({ title: e.message || "打开会话失败", icon: "none" });
      }
    },
  },
};
</script>

<style scoped>
.af-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
}

.af-input {
  flex: 1;
  height: 36px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 14px;
}

.af-ph {
  color: var(--ink-4);
}

.af-search-btn {
  height: 36px;
  padding: 0 16px;
  border-radius: 8px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.af-search-text {
  color: var(--on-primary);
  font-size: 13px;
}

.af-results {
  padding: 0;
  overflow: hidden;
}

.af-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.af-row:last-child {
  border-bottom: none;
}

.af-row--active {
  background: var(--brand-soft);
}

.af-main {
  flex: 1;
  min-width: 0;
}

.af-name {
  font-size: 15px;
  color: var(--ink);
  font-weight: 500;
}

.af-sub {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
}

.af-tag {
  font-size: 9px;
  color: var(--ink-3);
  background: var(--fill-2);
  border-radius: 4px;
  padding: 1px 5px;
}

.af-tag--ok {
  color: var(--ok-text);
  background: var(--ok-soft);
}

.af-arrow {
  font-size: 20px;
  color: var(--ink-4);
}

.af-label {
  display: block;
  margin-top: 16px;
  font-size: 12px;
  color: var(--ink-3);
}

.af-textarea {
  width: 100%;
  min-height: 64px;
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 13px;
  box-sizing: border-box;
}

.af-primary {
  height: 40px;
  border-radius: 8px;
  background: var(--brand);
  display: flex;
  align-items: center;
  justify-content: center;
}

.af-primary-text {
  color: var(--on-primary);
  font-size: 14px;
  font-weight: 500;
}

.af-hint {
  margin-top: 16px;
  padding: 10px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 12px;
  color: var(--ink-3);
}

.af-tip {
  margin-top: 14px;
  font-size: 11px;
  color: var(--ink-4);
  line-height: 1.6;
}
</style>
