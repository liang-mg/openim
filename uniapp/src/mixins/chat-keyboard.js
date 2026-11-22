/**
 * 聊天键盘适配（可复用 mixin）。
 *
 * 统一处理 H5 visualViewport / App onKeyboardHeightChange 与聊天根节点的 padding：
 * - H5：visualViewport 高度差作为键盘高度；
 * - App：adjustResize 下 WebView 可能已自行压缩，此时不再 padding；
 * - Vivo 键盘事件可能先于 resize，300ms 后复检一次；
 * - 依赖宿主页面的 scrollToBottom(true) 方法。
 */
export default {
  data() {
    return {
      keyboardHeight: 0,
      baseInnerHeight: 0,
      inputFocused: false,
      keyboardTimer: null,
      keyboardRecheck: null,
      offKeyboard: null,
      offViewport: null,
    };
  },
  computed: {
    chatStyle() {
      return this.keyboardHeight > 0 ? { paddingBottom: `${this.keyboardHeight}px` } : {};
    },
  },
  methods: {
    setupKeyboard() {
      // #ifdef APP-PLUS
      this.baseInnerHeight = typeof window !== "undefined" ? Number(window.innerHeight || 0) : 0;
      if (typeof uni.onKeyboardHeightChange === "function") {
        this.offKeyboard = (res) => this.applyKeyboard(res && res.height, "app");
        uni.onKeyboardHeightChange(this.offKeyboard);
      }
      // #endif
      // #ifdef H5
      if (typeof window !== "undefined" && window.visualViewport) {
        this.offViewport = () => {
          const vv = window.visualViewport;
          const kh = Math.max(0, window.innerHeight - (vv.height + vv.offsetTop));
          this.applyKeyboard(kh, "h5");
        };
        window.visualViewport.addEventListener("resize", this.offViewport);
        window.visualViewport.addEventListener("scroll", this.offViewport);
      }
      // #endif
    },
    applyKeyboard(height, source = "") {
      let next = Math.max(0, Math.min(500, Math.round(Number(height) || 0)));
      // #ifdef APP-PLUS
      // vivo 等机型在 adjustResize 下 WebView 已经自己缩到键盘上方；
      // 再给根节点 padding-bottom 会把输入框顶到屏幕中间（鸿蒙不缩，反而需要 padding）。
      if (source === "app" && next > 0 && this.baseInnerHeight > 0) {
        const shrunk = this.baseInnerHeight - Number(window.innerHeight || 0);
        if (shrunk > Math.max(80, next * 0.45)) next = 0;
      }
      // #endif
      if (next === this.keyboardHeight) return;
      this.keyboardHeight = next;
      // App 端键盘事件可能先于 WebView resize 到达：第一次按高度加了 padding，
      // 等 300ms 再确认一次；如果系统已经把视口压缩，就把 padding 撤掉。
      // #ifdef APP-PLUS
      if (this.keyboardRecheck) clearTimeout(this.keyboardRecheck);
      this.keyboardRecheck = null;
      if (next > 0 && source === "app") {
        this.keyboardRecheck = setTimeout(() => {
          this.keyboardRecheck = null;
          if (this.keyboardHeight <= 0 || !this.baseInnerHeight) return;
          const shrunk = this.baseInnerHeight - Number(window.innerHeight || 0);
          if (shrunk > Math.max(80, this.keyboardHeight * 0.45)) this.keyboardHeight = 0;
        }, 300);
      }
      // #endif
      if (next > 0) {
        this.$nextTick(() => this.scrollToBottom(true));
      }
    },
    onInputFocus() {
      this.inputFocused = true;
      if (this.keyboardTimer) {
        clearTimeout(this.keyboardTimer);
        this.keyboardTimer = null;
      }
      setTimeout(() => {
        if (this.inputFocused) {
          this.scrollToBottom(true);
          this.applyKeyboard(this.keyboardHeight);
        }
      }, 180);
    },
    onInputBlur() {
      this.inputFocused = false;
      if (this.keyboardTimer) clearTimeout(this.keyboardTimer);
      this.keyboardTimer = setTimeout(() => {
        if (!this.inputFocused) this.applyKeyboard(0);
      }, 260);
    },
  },
};
