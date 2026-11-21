<template>
  <view>
    <view class="flex items-center gap-2 mb-2.5">
      <view class="px-3.5 py-1.5 rounded-pill text-sm" :class="periodOffset === 0 ? 'bg-brand text-white' : 'bg-fill-2 text-ink-2'" @tap="switchPeriod(0)">今天</view>
      <view class="px-3.5 py-1.5 rounded-pill text-sm" :class="periodOffset === 1 ? 'bg-brand text-white' : 'bg-fill-2 text-ink-2'" @tap="switchPeriod(1)">昨天</view>
      <text class="ml-auto text-xs text-ink-3">{{ period }}</text>
    </view>

    <view v-if="locked" class="flex items-center px-3 py-2.5 rounded-ctl mb-2.5" :class="lockedBg">
      <text class="text-xs leading-5 text-ink-2">{{ lockedText }}</text>
    </view>

    <report-field
      v-for="field in fields" :key="field.key" v-model="content[field.key]"
      :label="field.label" :icon="field.icon" :placeholder="field.placeholder"
      :optional="field.optional" :locked="locked" :max="maxLen"
    />

    <view v-if="!locked" class="flex items-center justify-center gap-2 h-11 rounded-ctl border border-dashed border-ink-4 bg-fill" @tap="pickFiles">
      <app-icon name="paperclip" :size="16" tone="ink-3" />
      <text class="text-sm text-ink-3">点击添加附件 · 单个 ≤ 20MB</text>
    </view>
    <view v-else class="flex items-center justify-center gap-2 h-11 rounded-ctl border border-dashed border-ink-4 bg-fill opacity-70">
      <text class="text-sm text-ink-3">日报已提交，附件不可再增删</text>
    </view>

    <attach-list :list="attachments" :locked="locked" @remove="removeAttachment" @preview="previewAttachment" />

    <view class="flex gap-2.5 mt-4">
      <view class="oa-btn flex-1" :class="{ 'opacity-45': locked || submitting }" @tap="doSubmit('draft')">
        <text class="text-md text-ink">存草稿</text>
      </view>
      <view class="oa-btn-primary flex-1" :class="{ 'opacity-45': locked || submitting || !totalDone }" @tap="doSubmit('submitted')">
        <text class="text-md text-white font-medium">{{ submitText }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import AppIcon from "@/components/app-icon.vue";
import ReportField from "./report-field.vue";
import AttachList from "./attach-list.vue";
import { submitReport, uploadFile, getFileLink, fileIdOf } from "@/api/oa";

const MAX_LEN = 800;
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const ALLOWED_EXT = ["jpg", "jpeg", "png", "gif", "webp", "pdf", "doc", "docx", "xls", "xlsx", "txt", "zip"];
const IMAGE_EXT = ["jpg", "jpeg", "png", "gif", "webp"];
const EMPTY_CONTENT = () => ({ done: "", plan: "", issues: "" });
const FIELDS = [
  { key: "done", label: "今日完成", icon: "check", placeholder: "写下今天完成的工作，一条一行…", optional: false },
  { key: "plan", label: "明日计划", icon: "calendar", placeholder: "明天准备推进的事项…", optional: false },
  { key: "issues", label: "遇到问题", icon: "warning", placeholder: "需要协助或待确认的问题，没有可留空…", optional: true },
];

/**
 * 日报编辑器：今天/昨天切换、锁定提示、三个字段、附件、存草稿/提交。
 * 编辑器状态（content/attachments/periodOffset/submitting/loadedPeriod）与上传、提交接口都在这里，
 * 成功后 emit('submitted') 让页面 getReportOverview 刷新；recent 用于判断当前 period 是否已有报告。
 * 页面「复制昨天」通过 ref 调 fillFrom(content, periodKey) 回填（先记 loadedPeriod，不会被 watch 覆盖）。
 */
export default {
  name: "ReportEditor",
  components: { AppIcon, ReportField, AttachList },
  props: {
    recent: { type: Array, default: () => [] },
    today: { type: String, default: "" },
    yesterday: { type: String, default: "" },
  },
  emits: ["submitted", "period-change"],
  data() {
    return { maxLen: MAX_LEN, content: EMPTY_CONTENT(), attachments: [], periodOffset: 0, submitting: false, loadedPeriod: "", fields: FIELDS };
  },
  computed: {
    period() { return this.periodOffset === 0 ? this.today : this.yesterday; },
    current() { return this.recent.find((r) => r.period === this.period) || null; },
    locked() { return Boolean(this.current && this.current.status !== "draft"); },
    lockedBg() {
      const s = this.current && this.current.status;
      return { pending_leader: "bg-warn-soft", archived: "bg-fill-2" }[s] || "bg-brand-soft";
    },
    lockedText() {
      const s = this.current && this.current.status;
      if (s === "submitted") return "日报已提交，等待组长查阅；提交后 2 小时内可撤回修改。";
      if (s === "pending_leader") return "组长已点评并上报领导，正在等待领导查阅，内容不可再修改。";
      return s === "archived" ? "领导已归档，该日报内容已锁定，不可修改。" : "";
    },
    totalDone() {
      return this.content.done.length + this.content.plan.length + this.content.issues.length;
    },
    submitText() {
      if (this.locked) return this.current.status === "archived" ? "已归档" : "已提交";
      return this.submitting ? "提交中…" : "提交报告";
    },
  },
  watch: {
    period() {
      this.fillFromOverview();
    },
    /** 页面刷新（含提交/撤回后）会换新 recent 数组 → 强制回填服务端最新状态 */
    recent() {
      this.fillFromOverview(true);
    },
  },
  methods: {
    /** 切今天/昨天：内容由 period 的 watch 回填；emit 供页面按需同步当前 period */
    switchPeriod(offset) {
      if (this.periodOffset === offset) return;
      this.periodOffset = offset;
      this.$emit("period-change", { offset, period: this.period });
    },
    /** 页面「复制昨天」调用：带入内容并切到 periodKey 对应日期 */
    fillFrom(content, periodKey) {
      this.loadedPeriod = periodKey;
      this.periodOffset = periodKey === this.yesterday ? 1 : 0;
      this.content = { ...EMPTY_CONTENT(), ...content };
    },
    /** 回填该日期已有报告；force=false 时同一 period 只回填一次，避免覆盖正在输入的内容 */
    fillFromOverview(force = false) {
      if (this.loadedPeriod === this.period && !force) return;
      this.loadedPeriod = this.period;
      const rec = this.current;
      this.content = rec ? { ...EMPTY_CONTENT(), ...rec.content } : EMPTY_CONTENT();
      this.attachments = rec ? (rec.attachments || []).map((a, i) => ({ ...a, uid: `${rec.report_id}_${i}`, thumb: "", uploading: false })) : [];
      if (rec) this.loadThumbs();
    },
    /** 历史附件只有 file_id，图片缩略图要换签名地址（<image> 带不了 token 头） */
    async loadThumbs() {
      const pending = this.attachments.filter((a) => !a.thumb && IMAGE_EXT.includes(a.file_type) && a.url);
      await Promise.all(
        pending.map(async (a) => {
          const id = fileIdOf(a.url);
          if (!id) return;
          try {
            a.thumb = (await getFileLink(id)).signed_url || "";
          } catch (e) {
            /* 缩略图失败不影响提交 */
          }
        })
      );
    },
    pickFiles() {
      if (this.locked) return;
      uni.chooseFile({
        count: 5,
        extension: ALLOWED_EXT,
        success: (res) => (res.tempFiles || []).forEach((f) => this.addFile(f)),
        fail: (err) => {
          if (String((err && err.errMsg) || "").includes("cancel")) return;
          this.pickImageFallback();
        },
      });
    },
    pickImageFallback() {
      const add = (res) => {
        const path = (res.tempFilePaths || [])[0];
        const info = (res.tempFiles || [])[0] || {};
        if (path) this.addFile({ path, name: info.name || `photo_${Date.now()}.jpg`, size: info.size || 0 });
      };
      uni.chooseImage({ count: 1, success: add });
    },
    addFile(file) {
      const name = file.name || "附件";
      const ext = (name.split(".").pop() || "").toLowerCase();
      if (!ALLOWED_EXT.includes(ext) || (file.size || 0) > MAX_FILE_SIZE) {
        return uni.showToast({ title: "文件不符合要求（≤20MB，常见文档/图片格式）", icon: "none" });
      }
      const uid = `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const item = { uid, name, size: file.size || 0, file_type: ext, url: "", thumb: "", uploading: true };
      this.attachments.push(item);
      uploadFile(file.path, "report")
        .then((res) => Object.assign(item, { url: res.url, thumb: res.signed_url || "", uploading: false }))
        .catch(() => {
          this.attachments = this.attachments.filter((a) => a.uid !== uid);
          uni.showToast({ title: `「${name}」上传失败，请重试`, icon: "none" });
        });
    },
    removeAttachment(uid) {
      if (!this.locked) this.attachments = this.attachments.filter((a) => a.uid !== uid);
    },
    previewAttachment(a) {
      if (a.thumb && IMAGE_EXT.includes(a.file_type)) uni.previewImage({ urls: [a.thumb] });
    },
    async doSubmit(status) {
      const toast = (title) => uni.showToast({ title, icon: "none" });
      if (this.locked) return toast("该日报已提交，当前不可修改");
      if (status === "submitted" && !this.content.done.trim()) return toast("先写下今天完成的工作再提交");
      if (this.attachments.some((a) => a.uploading)) return toast("附件还在上传，请稍候再提交");
      this.submitting = true;
      try {
        await submitReport({
          type: "daily", period: this.period, status,
          content: { ...this.content },
          attachments: this.attachments.map(({ name, size, file_type, url }) => ({ name, size, file_type, url })),
        });
        toast(status === "draft" ? "草稿已保存" : this.periodOffset === 0 ? "日报提交成功" : "补写的日报已提交");
        this.content = EMPTY_CONTENT(); this.attachments = []; this.periodOffset = 0; this.loadedPeriod = this.period;
        this.$emit("submitted");
      } catch (e) {
        toast(e.message || "保存失败，请重试");
      } finally { this.submitting = false; }
    },
  },
};
</script>
