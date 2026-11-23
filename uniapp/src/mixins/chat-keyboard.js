/**
 * 聊天键盘适配（可复用 mixin）。
 *
 * 统一处理 H5 visualViewport / App 键盘事件，以及聊天根节点的布局：
 * - H5：visualViewport 高度差作为键盘高度，并用 padding 避开覆盖区域；
 * - App：优先使用 manifest 的 adjustResize，让 flex 布局跟随 WebView 缩小；
 * - App：如果系统只上报键盘高度但 WebView 没有缩小，再按差值补一个兜底 padding；
 * - 不按手机品牌判断，兼容不同 Android / HarmonyOS 的事件时序；
 * - 依赖宿主页面的 scrollToBottom(true) 方法。
 */
export default {
  data() {
    return {
      keyboardHeight: 0,
      reportedKeyboardHeight: 0,
      appBaseWindowHeight: 0,
      appWindowHeight: 0,
      appKeyboardInset: 0,
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
      // #ifdef APP-PLUS
      // adjustResize 正常时这里为 0；只有窗口没有缩小且键盘仍覆盖内容时才补高度。
      return this.appKeyboardInset > 0 ? { paddingBottom: `${this.appKeyboardInset}px` } : {};
      // #endif
      return {};
    },
  },
  methods: {
    normalizeKeyboardHeight(value) {
      return Math.max(0, Math.min(500, Math.round(Number(value) || 0)));
    },
    readAppWindowHeight(payload) {
      const size = payload && payload.size ? payload.size : payload;
      const fromEvent = Number(size && (size.windowHeight || size.height));
      if (fromEvent > 0) return fromEvent;
      if (typeof uni.getWindowInfo === "function") {
        const info = uni.getWindowInfo();
        const height = Number(info && info.windowHeight);
        if (height > 0) return height;
      }
      if (typeof uni.getSystemInfoSync === "function") {
        const info = uni.getSystemInfoSync();
        const height = Number(info && info.windowHeight);
        if (height > 0) return height;
      }
      return 0;
    },
    updateAppWindowHeight(value) {
      const next = this.readAppWindowHeight(value);
      if (!next) return;
      this.appWindowHeight = next;
      // 键盘未参与布局时，新的窗口高度就是下一次键盘检测的基准（也能适配旋转）。
      // 输入框获得焦点后，键盘打开前后的 resize 事件都不能改写基准高度；
      // 否则某些设备会先发 windowResize、后发 keyboardHeightChange，导致把缩小后的高度当成基准。
      if (!this.inputFocused && !this.reportedKeyboardHeight) this.appBaseWindowHeight = next;
      this.reconcileAppKeyboardInset();
    },
    reconcileAppKeyboardInset() {
      const reported = this.normalizeKeyboardHeight(this.reportedKeyboardHeight);
      if (!reported) {
        this.appKeyboardInset = 0;
        this.keyboardHeight = 0;
        return;
      }

      // 如果 adjustResize 已经让窗口缩短，缩短部分不能再次计入 padding。
      const resized = Math.max(0, this.appBaseWindowHeight - this.appWindowHeight);
      const remaining = Math.max(0, reported - resized);
      // 窗口尺寸事件存在少量抖动，24px 以内的残差视为已完成 resize。
      const next = remaining > 24 ? remaining : 0;
      if (next === this.appKeyboardInset) return;
      this.appKeyboardInset = next;
      this.keyboardHeight = next;
    },
    setupKeyboard() {
      // #ifdef APP-PLUS
      this.updateAppWindowHeight();
      if (typeof uni.onWindowResize === "function") {
        this.offWindowResize = (res) => {
          this.updateAppWindowHeight(res);
          // adjustResize 或兜底 padding 改变可用高度后，再滚动一次。
          if (this.inputFocused) this.$nextTick(() => this.scrollToBottom(true));
        };
        uni.onWindowResize(this.offWindowResize);
      }
      if (typeof uni.onKeyboardHeightChange === "function") {
        this.offKeyboard = (res) => {
          this.reportedKeyboardHeight = this.normalizeKeyboardHeight(res && res.height);
          this.updateAppWindowHeight();
          this.reconcileAppKeyboardInset();
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
      this.reportedKeyboardHeight = this.normalizeKeyboardHeight(height);
      this.updateAppWindowHeight();
      this.reconcileAppKeyboardInset();
      return;
      // #endif
      const next = this.normalizeKeyboardHeight(height);
      if (next === this.keyboardHeight) return;
      this.keyboardHeight = next;
      if (next > 0) this.$nextTick(() => this.scrollToBottom(true));
    },
    onInputFocus() {
      this.inputFocused = true;
      // 在键盘弹起前记录可用高度，作为判断 adjustResize 是否生效的基准。
      // #ifdef APP-PLUS
      const current = this.readAppWindowHeight();
      if (current > 0) {
        this.appWindowHeight = current;
        this.appBaseWindowHeight = current;
      }
      // #endif
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
          this.appKeyboardInset = 0;
          this.applyKeyboard(0, "blur");
        }
      }, 260);
    },
  },
};
