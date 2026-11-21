import { createSSRApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
// Tailwind 入口（@tailwind 指令 + .oa-* 组件类）；必须早于页面样式加载
import "./styles/tailwind.css";

export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  return { app };
}
