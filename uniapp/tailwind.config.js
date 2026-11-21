/** @type {import('tailwindcss').Config} */
/**
 * Tailwind 配置（uni-app H5 / App）。
 *
 * 两个关键决定：
 *  1. corePlugins.preflight = false：Preflight 会把 view/text/button 的默认样式全部重置，
 *     uni-app 的组件（button/input/picker/switch）依赖这些默认值，开了会整体走形。
 *  2. 颜色/圆角/字号直接对齐 App.vue 里的 CSS 变量值：Tailwind 类负责布局与间距，
 *     设计变量负责主题色，两边同一个色值只写一次（改主题时对照改这里）。
 *
 * 注意：小程序端 Tailwind 需要 weapp-tailwindcss 转义，本项目只覆盖 H5/App，
 * 将来若出小程序，必须先接 weapp-tailwindcss 再启用这些类。
 */
module.exports = {
  content: ["./index.html", "./src/**/*.{vue,js}"],
  corePlugins: { preflight: false },
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#0b5fd8", dark: "#0848a8", soft: "#eaf2fe" },
        ink: { DEFAULT: "#1f2329", 2: "#5c6370", 3: "#8a9099", 4: "#b6bcc6" },
        ok: { DEFAULT: "#22a06b", text: "#12a870", soft: "#e8f7ee" },
        warn: { DEFAULT: "#f5a623", text: "#a56500", soft: "#fff6e5" },
        danger: { DEFAULT: "#e34d59", soft: "#fdecee" },
        line: "#eef0f3",
        page: "#f4f6f9",
        fill: { DEFAULT: "#f7f9fc", 2: "#f2f5f9" },
      },
      borderRadius: {
        card: "12px",
        ctl: "8px",
        sheet: "16px",
        pill: "999px",
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["12px", { lineHeight: "18px" }],
        base: ["13px", { lineHeight: "20px" }],
        md: ["14px", { lineHeight: "22px" }],
        lg: ["15px", { lineHeight: "22px" }],
        xl: ["17px", { lineHeight: "24px" }],
        "2xl": ["20px", { lineHeight: "26px" }],
      },
      spacing: {
        4.5: "18px",
        13: "52px",
      },
      boxShadow: {
        card: "0 2px 8px rgba(31, 35, 41, 0.04)",
        sheet: "0 -8px 24px rgba(31, 35, 41, 0.12)",
      },
    },
  },
  plugins: [],
};
