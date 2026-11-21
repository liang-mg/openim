/**
 * PostCSS 配置：Tailwind + autoprefixer。
 *
 * uni-app 的 vite 插件自带一套 postcss 处理，这里只**追加**插件，不覆盖它的预设；
 * 实测 build:h5 能正常产出 utilities 与 @apply 结果。
 */
module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
