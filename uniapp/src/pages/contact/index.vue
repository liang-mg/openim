<template>
  <view class="app-page ct">
    <view class="app-topbar">
      <text class="app-topbar__title">通讯录</text>
      <view class="ct__actions">
        <text class="ct__count">{{ loading && !friends.length && !groups.length ? "加载中" : tab === "friends" ? `${filteredFriends.length} 位好友` : `${filteredGroups.length} 个群` }}</text>
        <view class="ct__plus" @tap="showAddMenu">
          <app-icon name="plus" :size="24" color="#ffffff" />
        </view>
      </view>
    </view>

    <view class="ct__entries">
      <view class="ct__entry" @tap="goNewFriends">
        <view class="ct__entry-icon">朋</view>
        <view class="ct__entry-main">
          <text class="ct__entry-title">新的朋友</text>
          <text class="ct__entry-sub">好友申请与验证消息</text>
        </view>
        <view v-if="badges.friend" class="ct__badge"><text class="ct__badge-text">{{ badges.friend > 99 ? "99+" : badges.friend }}</text></view>
        <text class="ct__arrow">›</text>
      </view>
      <view class="ct__entry" @tap="goGroupNotifications">
        <view class="ct__entry-icon ct__entry-icon--group">群</view>
        <view class="ct__entry-main">
          <text class="ct__entry-title">群通知</text>
          <text class="ct__entry-sub">加群申请与邀请</text>
        </view>
        <view v-if="badges.group" class="ct__badge"><text class="ct__badge-text">{{ badges.group > 99 ? "99+" : badges.group }}</text></view>
        <text class="ct__arrow">›</text>
      </view>
    </view>

    <view class="ct__tabs">
      <view class="ct__tab" :class="{ 'ct__tab--active': tab === 'friends' }" @tap="tab = 'friends'">
        <text class="ct__tab-text">好友</text>
      </view>
      <view class="ct__tab" :class="{ 'ct__tab--active': tab === 'groups' }" @tap="tab = 'groups'">
        <text class="ct__tab-text">群聊</text>
      </view>
    </view>

    <view class="ct__search">
      <input v-model="keyword" class="ct__search-input" :placeholder="tab === 'friends' ? '搜索好友' : '搜索群聊'" placeholder-class="ct__ph" />
    </view>

    <view class="ct__list">
      <view v-if="loading && !current.length" class="empty"><text>正在加载通讯录…</text></view>
      <view v-else-if="!current.length" class="empty"><text>{{ keyword ? "没有匹配的结果" : "暂无数据" }}</text></view>

      <person-row v-for="item in current" :key="item.id" :item="item" @open="openChat" @card="openCard" />

      <view class="page-bottom-space" />
    </view>

    <app-tabbar active="contact" />
  </view>
</template>

<script>
import { hideNativeTabBar } from "@/utils/tabbar";
import AppIcon from "@/components/app-icon.vue";
import OimAvatar from "@/components/oim-avatar.vue";
import AppTabbar from "@/components/app-tabbar.vue";
import PersonRow from "./components/person-row.vue";
import { listFriends, listGroups, connect, getState, getOrCreateConversation, getApplicationUnhandled, on } from "@/api/im";
import { getToken } from "@/utils/storage";
import { peek, put } from "@/utils/swr";
import { useUserStore } from "@/store/user";
import { useIMStore } from "@/store/im";

/**
 * 通讯录。对应 PC 端 frontend/src/pages/contact/：
 *   好友 / 群聊 两个列表（PC 还有「新的朋友」「群通知」，需要 IM 好友申请接口，先在待办里）。
 * 点人/点群先 getOneConversation 拿真实会话 ID（si_/sg_），再进聊天页。
 */
export default {
  components: { AppIcon, OimAvatar, AppTabbar, PersonRow },
  data() {
    return {
      tab: "friends",
      keyword: "",
      friends: [],
      groups: [],
      badges: {
        friend: useIMStore().friendApplications,
        group: useIMStore().groupApplications,
      },
      connected: false,
      loading: true,
      busy: false,
      offApp: null,
      offState: null,
      offSync: null,
    };
  },
  computed: {
    filteredFriends() {
      const k = this.keyword.trim();
      const list = this.friends.map((f) => ({
        id: f.userID,
        name: f.remark || f.nickname || f.userID,
        sub: f.remark ? f.nickname : "IM 好友",
        online: f.online,
        group: false,
      }));
      return k ? list.filter((f) => f.name.includes(k) || f.sub.includes(k)) : list;
    },
    filteredGroups() {
      const k = this.keyword.trim();
      const list = this.groups.map((g) => ({
        id: g.groupID,
        name: g.groupName || g.name,
        sub: `${g.memberCount || 0} 人`,
        online: false,
        group: true,
      }));
      return k ? list.filter((g) => g.name.includes(k)) : list;
    },
    current() {
      return this.tab === "friends" ? this.filteredFriends : this.filteredGroups;
    },
  },
  onShow() {
    hideNativeTabBar();
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    if (!this.offApp) {
      this.offApp = on("application", () => this.loadBadges());
    }
    if (!this.offSync) {
      this.offSync = on("sync", () => this.load());
    }
    if (!this.offState) {
      this.offState = on("state", (s) => {
        this.connected = s === "connected";
        if (s === "connected") {
          this.load();
          this.loadBadges();
        }
      });
    }
    useUserStore()
      .fetchProfile()
      .catch(() => {});
    this.load();
    this.loadBadges();
  },
  onUnload() {
    if (this.offApp) this.offApp();
    if (this.offState) this.offState();
    if (this.offSync) this.offSync();
  },
  methods: {
    goNewFriends() {
      uni.navigateTo({ url: "/pages/contact/new-friends/index" });
    },
    goGroupNotifications() {
      uni.navigateTo({ url: "/pages/group/notifications/index" });
    },
    showAddMenu() {
      uni.showActionSheet({
        itemList: ["添加好友", "创建群聊", "加入群组"],
        success: (res) => {
          if (res.tapIndex === 0) uni.navigateTo({ url: "/pages/contact/add-friend/index" });
          else if (res.tapIndex === 1) uni.navigateTo({ url: "/pages/group/create/index" });
          else uni.navigateTo({ url: "/pages/contact/add-group/index" });
        },
      });
    },
    async loadBadges() {
      if (getState() !== "connected") return;
      try {
        this.badges = await getApplicationUnhandled();
        useIMStore().setApplications(this.badges);
      } catch (e) {
        /* 红点失败不打扰 */
      }
    },
    async openCard(item) {
      if (item.group) {
        uni.navigateTo({ url: `/pages/group/settings/index?groupID=${encodeURIComponent(item.id)}` });
        return;
      }
      uni.navigateTo({
        url: `/pages/contact/user-card/index?userID=${encodeURIComponent(item.id)}&name=${encodeURIComponent(item.name || "")}`,
      });
    },
    async load() {
      if (this.busy) return;
      this.busy = true;
      this.loading = true;
      // 先铺缓存：切回通讯录 tab 不该看到空白
      const cached = peek("im:contacts");
      if (cached) {
        this.friends = cached.friends || [];
        this.groups = cached.groups || [];
      }
      try {
        await connect();
      } catch (e) {
        // 连接失败时保留缓存，不能把好友列表清空成“0 位好友”
        this.connected = false;
        this.loading = false;
        this.busy = false;
        uni.showToast({ title: e.message || "IM 连接失败", icon: "none", duration: 2600 });
        return;
      }
      this.connected = getState() === "connected";
      if (!this.connected) {
        this.loading = false;
        this.busy = false;
        return;
      }
      try {
        const [friends, groups] = await Promise.all([listFriends(), listGroups()]);
        this.friends = friends;
        this.groups = groups;
        put("im:contacts", { friends, groups });
      } catch (e) {
        if (!peek("im:contacts")) {
          this.friends = [];
          this.groups = [];
        }
        uni.showToast({ title: e.message || "通讯录加载失败", icon: "none" });
      } finally {
        this.loading = false;
        this.busy = false;
      }
    },
    async openChat(item) {
      try {
        // 真实会话 ID 是 si_<a>_<b> / sg_<groupID>，不能再用 mock 的 single_<userID>
        const conv = await getOrCreateConversation({
          sourceID: item.id,
          sessionType: item.group ? 3 : 1,
        });
        if (!conv || !conv.conversationID) throw new Error("会话创建失败");
        uni.navigateTo({
          url: `/pages/chat/index?conversationID=${encodeURIComponent(conv.conversationID)}&name=${encodeURIComponent(item.name)}&group=${item.group ? 1 : 0}`,
        });
      } catch (e) {
        uni.showToast({ title: e.message || "打开会话失败", icon: "none" });
      }
    },
  },
};
</script>

<style scoped>
.ct__actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.ct__count {
  font-size: 11px;
  opacity: 0.9;
}

.ct__plus {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: -6px;
}

.ct__entries {
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.ct__entry {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--line);
}

.ct__entry:last-child {
  border-bottom: none;
}

.ct__entry:active {
  background: var(--fill);
}

.ct__entry-icon {
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--brand-soft);
  color: var(--brand);
  font-size: 16px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.ct__entry-icon--group {
  background: var(--ok-soft);
  color: var(--ok-text);
}

.ct__entry-main {
  flex: 1;
  min-width: 0;
}

.ct__entry-title {
  display: block;
  font-size: 15px;
  color: var(--ink);
  font-weight: 500;
}

.ct__entry-sub {
  display: block;
  margin-top: 2px;
  font-size: 11px;
  color: var(--ink-3);
}

.ct__badge {
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--danger);
  display: flex;
  align-items: center;
  justify-content: center;
}

.ct__badge-text {
  font-size: 10px;
  color: #fff;
  font-weight: 600;
  line-height: 1;
}

.ct__arrow {
  font-size: 20px;
  color: var(--ink-4);
}

.ct__tabs {
  display: flex;
  background: #fff;
  border-bottom: 1px solid var(--line);
}

.ct__tab {
  flex: 1;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.ct__tab-text {
  font-size: 14px;
  color: var(--ink-2);
}

.ct__tab--active .ct__tab-text {
  color: var(--brand);
  font-weight: 600;
}

.ct__tab--active::after {
  content: "";
  position: absolute;
  bottom: 0;
  width: 40px;
  height: 2px;
  background: var(--brand);
  border-radius: 1px;
}

.ct__search {
  padding: 8px 12px;
  background: #fff;
}

.ct__search-input {
  height: 34px;
  padding: 0 12px;
  border-radius: 8px;
  background: var(--fill-2);
  font-size: 13px;
}

.ct__ph {
  color: var(--ink-4);
}

.ct__list {
  background: #fff;
}

.person {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--line);
}

.person:active {
  background: var(--fill);
}

.person__main {
  flex: 1;
  min-width: 0;
}

.person__head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.person__name {
  font-size: 15px;
  color: var(--ink);
  font-weight: 500;
}

.person__online {
  font-size: 9px;
  color: var(--ok-text);
  background: var(--ok-soft);
  border-radius: 4px;
  padding: 1px 5px;
}

.person__sub {
  display: block;
  margin-top: 3px;
  font-size: 11px;
  color: var(--ink-3);
}

.person__arrow {
  font-size: 18px;
  color: var(--ink-4);
}

</style>
