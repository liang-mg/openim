/**
 * IM 全局未读 / 好友申请红点。
 *
 * 为什么不用页面里的 unread：底部 tabbar 用 reLaunch 切页，页面实例和
 * 页面内 data 都会重建；红点必须落在 store + storage 里，切到任意 tab
 * 都能看到未读数，消息已读后也能全局归零。
 */
import { defineStore } from "pinia";
import { on, getState, totalUnread, getApplicationUnhandled } from "@/api/im";

const KEY = "oa_im_badge_v1";

function readCache() {
  try {
    const v = uni.getStorageSync(KEY);
    if (!v) return {};
    return typeof v === "string" ? JSON.parse(v) || {} : v;
  } catch (e) {
    return {};
  }
}

function writeCache(state) {
  try {
    uni.setStorageSync(KEY, {
      unread: Number(state.unread || 0),
      friendApplications: Number(state.friendApplications || 0),
      groupApplications: Number(state.groupApplications || 0),
    });
  } catch (e) {
    /* ignore */
  }
}

const cached = readCache();

export const useIMStore = defineStore("im", {
  state: () => ({
    unread: Number(cached.unread || 0),
    friendApplications: Number(cached.friendApplications || 0),
    groupApplications: Number(cached.groupApplications || 0),
    connected: false,
    bound: false,
    refreshing: false,
    lastBoundAt: 0,
  }),
  getters: {
    contactApplications: (state) => Number(state.friendApplications || 0) + Number(state.groupApplications || 0),
  },
  actions: {
    setUnread(n) {
      this.unread = Math.max(0, Number(n || 0));
      writeCache(this);
    },
    setApplications({ friend = 0, group = 0 } = {}) {
      this.friendApplications = Math.max(0, Number(friend || 0));
      this.groupApplications = Math.max(0, Number(group || 0));
      writeCache(this);
    },
    reset() {
      this.unread = 0;
      this.friendApplications = 0;
      this.groupApplications = 0;
      this.connected = false;
      writeCache(this);
    },
    /** 只在 App 启动调用一次；页面 reLaunch 不会重复注册 */
    bind() {
      if (this.bound) return;
      this.bound = true;
      this.lastBoundAt = Date.now();
      on("unread", (n) => this.setUnread(n));
      on("state", (s) => {
        this.connected = s === "connected";
        if (s === "connected") {
          this.refresh();
          this.refreshApplications();
        }
      });
      on("application", () => this.refreshApplications());
      if (getState() === "connected") {
        this.refresh();
        this.refreshApplications();
      }
    },
    async refresh() {
      if (this.refreshing) return;
      this.refreshing = true;
      try {
        const n = await totalUnread();
        this.setUnread(n);
      } catch (e) {
        /* 连接未就绪时忽略，等 connected 事件 */
      } finally {
        this.refreshing = false;
      }
    },
    async refreshApplications() {
      try {
        const counts = await getApplicationUnhandled();
        this.setApplications(counts);
      } catch (e) {
        /* 红点失败不打扰 */
      }
    },
  },
});

export default useIMStore;
