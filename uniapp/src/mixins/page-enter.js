/**
 * tab 页面进入动画：switchTab 会保留页面实例，页面不会重新 mount，
 * 因此不能只靠 .app-page 的 mount 动画。这里在每次 onShow 重新挂 160ms 的
 * 轻微上浮/淡入，给切 tab 一个明确的过渡，同时不重建页面、不影响数据。
 */
export default {
  data() {
    return { pageEnter: false };
  },
  onShow() {
    this.pageEnter = false;
    this.$nextTick(() => {
      setTimeout(() => {
        this.pageEnter = true;
        setTimeout(() => {
          this.pageEnter = false;
        }, 200);
      }, 16);
    });
  },
};
