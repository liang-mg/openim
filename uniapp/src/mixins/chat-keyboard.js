/**
 * 聊天键盘适配（可复用 mixin）。
 *
 * 统一处理 H5 visualViewport / App 键盘与窗口尺寸变化，以及聊天根节点的 padding：
 * - H5：visualViewport 高度差作为键盘高度；
 * - App：同时看 onKeyboardHeightChange 和 onWindowResize，只做一次补偿；
 * - 不按手机品牌判断，兼容不同 Android / HarmonyOS 的事件时序；
 * - 依赖宿主页面的 scrollToBottom(true) 方法。
 */
export default {
  data() {
    return {
      keyboardHeight: 0,
      baseInnerHeight: 0,
      currentInnerHeight: 0,
      reportedKeyboardHeight: 0,
      inputFocused: false,
      keyboardTimer: null,
      keyboardRecheck: null,
      baselineTimer: null,
      offKeyboard: null,
      offWindowResize: null,
      offViewport: null,
    };
  },
  computed: {
    chatStyle() {
      return this.keyboardHeight > 0 ? { paddingBottom: `${this.keyboardHeight}px` } : {};
    },
  },
  methods: {
    normalizeKeyboardHeight(value) {
      return Math.max(0, Math.min(500, Math.round(Number(value) || 0)));
    },
    readWindowHeight() {
      try {
        if (typeof uni !== "undefined" && typeof uni.getWindowInfo === "function") {
          const info = uni.getWindowInfo();
          const h = Number(info && info.windowHeight) || 0;
          if (h > 0) return h;
        }
      } catch (e) {
        /* ignore */
      }
      try {
        return typeof window !== "undefined" ? Number(window.innerHeight || 0) : 0;
      } catch (e) {
        return 0;
      }
    },
    viewportAlreadyResized(reportedHeight) {
      const base = Number(this.baseInnerHeight || 0);
      const current = Number(this.currentInnerHeight || this.readWindowHeight() || 0);
      if (!base || !current || !reportedHeight) return false;
      const shrink = base - current;
      // 80px filters out status/navigation-bar jitter; the ratio handles keyboards
      // with different heights without relying on a particular device or brand.
      return shrink > Math.max(80, Math.round(reportedHeight * 0.35));
    },
    scheduleBaseline() {
      if (this.baselineTimer) clearTimeout(this.baselineTimer);
      this.baselineTimer = setTimeout(() => {
        this.baselineTimer = null;
        if (this.inputFocused || this.reportedKeyboardHeight > 0) return;
        const h = this.readWindowHeight();
        if (h > 0) {
          this.baseInnerHeight = h;
          this.currentInnerHeight = h;
        }
      }, 350);
    },
    setupKeyboard() {
      // #ifdef APP-PLUS
      this.baseInnerHeight = this.readWindowHeight();
      this.currentInnerHeight = this.baseInnerHeight;
      if (typeof uni.onWindowResize === "function") {
        this.offWindowResize = (res) => {
          const h = Number(res && res.size && res.size.windowHeight) || 0;
          if (h > 0) this.currentInnerHeight = h;
          if (this.reportedKeyboardHeight > 0) {
            this.applyKeyboard(this.reportedKeyboardHeight, "resize");
          } else {
            this.applyKeyboard(0, "resize");
            this.scheduleBaseline();
          }
        };
        uni.onWindowResize(this.offWindowResize);
      }
      if (typeof uni.onKeyboardHeightChange === "function") {
        this.offKeyboard = (res) => {
          this.reportedKeyboardHeight = this.normalizeKeyboardHeight(res && res.height);
          const measured = this.readWindowHeight();
          // onWindowResize is authoritative when available. If the keyboard event
          // arrives first, use the smaller measurement until the resize callback.
          if (!this.offWindowResize || this.reportedKeyboardHeight === 0) {
            if (measured > 0) this.currentInnerHeight = measured;
          } else if (measured > 0 && measured < this.currentInnerHeight) {
            this.currentInnerHeight = measured;
          }
          this.applyKeyboard(this.reportedKeyboardHeight, "app");
          if (this.reportedKeyboardHeight > 0) this.scheduleKeyboardRecheck();
          else this.scheduleBaseline();
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
      let next = this.normalizeKeyboardHeight(height);
      // #ifdef APP-PLUS
      // adjustResize 已经把 WebView 压到键盘上方时，不再额外加 padding。
      // 这个判断依赖真实窗口高度，不依赖手机品牌或键盘名称。
      if (["app", "resize", "recheck"].includes(source) && next > 0 && this.viewportAlreadyResized(next)) {
        next = 0;
      }
      // #endif
      if (next === this.keyboardHeight) return;
      this.keyboardHeight = next;
      if (next > 0) this.$nextTick(() => this.scrollToBottom(true));
    },
    scheduleKeyboardRecheck() {
      if (this.keyboardRecheck) clearTimeout(this.keyboardRecheck);
      this.keyboardRecheck = null;
      this.keyboardRecheck = setTimeout(() => {
        this.keyboardRecheck = null;
        if (this.reportedKeyboardHeight <= 0) return;
        const measured = this.readWindowHeight();
        if (!this.offWindowResize && measured > 0) this.currentInnerHeight = measured;
        this.applyKeyboard(this.reportedKeyboardHeight, "recheck");
      }, 300);
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
          this.scheduleBaseline();
        }
      }, 260);
    },
  },
};
