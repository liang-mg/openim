/**
 * 聊天键盘适配（可复用 mixin）。
 *
 * 统一处理 H5 visualViewport / App 键盘事件，以及聊天根节点的布局：
 * - H5：visualViewport 高度差作为键盘高度，并用 padding 避开覆盖区域；
 * - App：使用 manifest 的 adjustResize，让 flex 布局跟随 WebView 缩小；
 * - App 键盘事件只负责触发滚动到底部，不再叠加 padding；
 * - 不按手机品牌判断，兼容不同 Android / HarmonyOS 的事件时序；
 * - 依赖宿主页面的 scrollToBottom(true) 方法。
 */
export default {
  data() {
    return {
      keyboardHeight: 0,
      reportedKeyboardHeight: 0,
      inputFocused: false,
      keyboardTimer: null,
      offKeyboard: null,
      offWindowResize: null,
      offViewport: null,
    };
  },
  computed: {
    chatStyle() {
      // #ifdef H5
      return this.keyboardHeight > 0 ? { paddingBottom: `${this.keyboardHeight}px` } : {};
      // #endif
      // App 端使用 adjustResize，根节点不能再叠加键盘高度，否则会出现输入框与键盘之间的空白。
      return {};
    },
  },
  methods: {
    normalizeKeyboardHeight(value) {
      return Math.max(0, Math.min(500, Math.round(Number(value) || 0)));
    },
    setupKeyboard() {
      // #ifdef APP-PLUS
      if (typeof uni.onWindowResize === "function") {
        this.offWindowResize = () => {
          // adjustResize 改变可用高度后，再滚动一次，确保最后一条消息仍在可视区域。
          if (this.inputFocused) this.$nextTick(() => this.scrollToBottom(true));
        };
        uni.onWindowResize(this.offWindowResize);
      }
      if (typeof uni.onKeyboardHeightChange === "function") {
        this.offKeyboard = (res) => {
          this.reportedKeyboardHeight = this.normalizeKeyboardHeight(res && res.height);
          if (this.reportedKeyboardHeight > 0) this.$nextTick(() => this.scrollToBottom(true));
        };
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
      // #ifdef APP-PLUS
      // App 端由 adjustResize + flex 负责布局；键盘事件只触发滚动，不写 padding。
      this.keyboardHeight = 0;
      return;
      // #endif
      const next = this.normalizeKeyboardHeight(height);
      if (next === this.keyboardHeight) return;
      this.keyboardHeight = next;
      if (next > 0) this.$nextTick(() => this.scrollToBottom(true));
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
        }
      }, 180);
    },
    onInputBlur() {
      this.inputFocused = false;
      if (this.keyboardTimer) clearTimeout(this.keyboardTimer);
      this.keyboardTimer = setTimeout(() => {
        if (!this.inputFocused) {
          this.reportedKeyboardHeight = 0;
          this.applyKeyboard(0, "blur");
        }
      }, 260);
    },
  },
};
