<template>
  <view class="app-page">
    <!-- 顶部蓝栏：返回 + 标题 + 姓名（对齐 PC checkin-topbar） -->
    <page-header title="拍照打卡" @back="back">
      <template #right>
        <text class="text-sm text-white/90">{{ user.displayName }}</text>
      </template>
    </page-header>

    <view class="px-3 pt-3 pb-7">
      <!-- 时钟 -->
      <view class="clock bg-[var(--brand-dark)] text-white rounded-card px-4 py-4 mb-3">
        <text class="text-sm opacity-85">{{ dateLabel }}</text>
        <text class="block text-[40px] font-semibold leading-tight my-1 tracking-wide">{{ clock }}</text>
        <text class="text-xs opacity-80">打卡时间以服务端为准</text>
      </view>

      <!-- 现场拍照 + 定位 -->
      <view class="bg-white rounded-card p-4 mb-3">
        <photo-block :photo="photo" :photo-error="photoError" @take="takePhoto" @clear="photo = ''" />
        <location-block
          :loc-data="locData"
          :loc-status="locStatus"
          :loc-message="locMessage"
          :loc-source="locSource"
          :today-office="today.office"
          :need-location="needLocation"
          @relocate="requestLocation"
        />
      </view>

      <!-- 提交：上班卡 / 下班卡（状态与禁用由 today/submitting 决定） -->
      <submit-bar :today="today" :submitting="submitting" @submit="doCheckin" />

      <!-- 今日记录 -->
      <record-list :today="today" @open-photo="openPhoto" />

      <view class="mt-3 px-4 py-3 bg-white rounded-card" @tap="goAttendance">
        <text class="text-base text-brand">查看本月出勤记录 →</text>
      </view>
    </view>

    <!-- 水印画布：移到屏幕外，仅用于合成照片 -->
    <canvas
      :canvas-id="canvasId"
      :id="canvasId"
      class="stamp-canvas fixed top-0 left-[-9999px]"
      :style="{ width: canvasW + 'px', height: canvasH + 'px' }"
    />
  </view>
</template>

<script>
import PageHeader from "@/components/page-header.vue";
import PhotoBlock from "./components/photo-block.vue";
import LocationBlock from "./components/location-block.vue";
import RecordList from "./components/record-list.vue";
import SubmitBar from "./components/submit-bar.vue";
import { getTodayCheckin, locateCheckin, locateCheckinByIp, submitCheckin, getFileLink, fileIdOf } from "@/api/oa";
import { stampPhoto, STAMP_W, STAMP_H, STAMP_CANVAS_ID } from "@/utils/image";
import { fmtDistance } from "@/utils/checkin";
import { bjNow, bjHMS, bjYmd, bjDateLabel } from "@/utils/beijing";
import { useUserStore } from "@/store/user";
import { getToken } from "@/utils/storage";

/**
 * 拍照打卡（页面层）。对齐 PC 端 frontend/src/pages/checkin/index.tsx：
 *   时钟卡 → 现场拍照（水印）→ 定位（服务端判范围）→ 提交上下班卡 → 今日记录。
 * 拆分（每个文件 ≤200 非空行）：photo-block 拍照 / location-block 定位 /
 *   record-list 今日记录 / submit-bar 提交区；本页只留 uni.chooseImage + 水印合成、
 *   定位取数、提交编排与接口调用。
 * 移动端差异：相机用 uni.chooseImage(sourceType:['camera'])；水印用 uni canvas 合成。
 */
export default {
  components: { PageHeader, PhotoBlock, LocationBlock, RecordList, SubmitBar },
  data() {
    return {
      today: { on: null, off: null, office: null, rule: null },
      loading: false,
      submitting: false,
      photo: "",
      photoError: false,
      locStatus: "idle", // idle | locating | ok | error
      locData: null,
      /** gps = 真定位；ip = GPS 失败后按网络位置兜底（精度低，界面上要标出来） */
      locSource: "gps",
      locMessage: "",
      now: new Date(),
      clock: "00:00:00",
      timer: null,
      canvasW: STAMP_W,
      canvasH: STAMP_H,
      canvasId: STAMP_CANVAS_ID,
    };
  },
  computed: {
    user() {
      return useUserStore();
    },
    dateLabel() {
      return bjDateLabel(Date.now());
    },
    /** 规则是否要求定位（未配置时按要求处理，与 PC 的 need_location ?? true 一致） */
    needLocation() {
      return !this.today.rule || this.today.rule.need_location !== false;
    },
  },
  onShow() {
    if (!getToken()) {
      uni.reLaunch({ url: "/pages/login/index" });
      return;
    }
    this.user.fetchProfile().catch(() => {});
    this.load();
    this.requestLocation();
  },
  onUnload() {
    if (this.timer) clearInterval(this.timer);
  },
  mounted() {
    this.tick();
    this.timer = setInterval(this.tick, 1000);
  },
  methods: {
    tick() {
      // 一律按北京时间显示（设备时区可能是别的，U 盘/模拟器/出差都会踩）
      this.now = bjNow();
      this.clock = bjHMS(Date.now());
    },
    async load() {
      try {
        const data = await getTodayCheckin();
        this.today = {
          on: data.on || null,
          off: data.off || null,
          office: data.office || null,
          rule: data.rule || null,
        };
      } catch (e) {
        uni.showToast({ title: e.message || "加载失败", icon: "none" });
      }
    },
    requestLocation() {
      this.locStatus = "locating";
      this.locMessage = "";
      this.locSource = "gps";
      const fail = (msg) => {
        this.locStatus = "error";
        this.locMessage = msg;
      };
      /** GPS 拿不到时按请求来源 IP 粗略定位：只保证打卡流程不卡死，精度低，界面标 locSource="ip"。 */
      const fallbackByIp = async (reason) => {
        this.locSource = "ip";
        try {
          const data = await locateCheckinByIp();
          this.locData = data;
          this.locStatus = "ok";
          this.locMessage = reason ? `${reason}，已按网络位置估算` : "已按网络位置估算";
        } catch (e) {
          this.locSource = "gps";
          fail(reason || e.message || "无法获取位置，请检查系统定位开关与网络");
        }
      };
      uni.getLocation({
        // 用 wgs84：H5 上 gcj02 需要地图服务商 key（没配会直接失败），
        // 且服务端按 PC 端上传的 WGS84 坐标算距离，两端必须同一坐标系。
        type: "wgs84",
        isHighAccuracy: true,
        highAccuracyExpireTime: 8000,
        success: async (pos) => {
          try {
            const data = await locateCheckin(pos.latitude, pos.longitude);
            this.locData = data;
            this.locStatus = "ok";
          } catch (e) {
            fail(e.message || "定位解析失败，请重试");
          }
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || "";
          if (msg.includes("auth") || msg.includes("deny") || msg.includes("permission")) {
            // 权限被拒时不再偷偷兜底，明确告知用户去开权限
            fail("定位权限被拒绝，请在系统设置里允许「位置」后重试");
          } else if (msg.includes("timeout")) {
            fallbackByIp("定位超时");
          } else {
            fallbackByIp("无法获取 GPS 位置");
          }
        },
      });
    },
    takePhoto() {
      uni.chooseImage({
        count: 1,
        sizeType: ["compressed"],
        sourceType: ["camera"],
        success: async (res) => {
          const path = res.tempFilePaths && res.tempFilePaths[0];
          if (!path) return;
          this.photoError = false;
          uni.showLoading({ title: "处理中…", mask: true });
          try {
            const stampPlace =
              this.locStatus === "ok" && this.locData
                ? this.locData.address ||
                  `${Number(this.locData.lat).toFixed(5)},${Number(this.locData.lng).toFixed(5)}`
                : "";
            const stamp = `${bjYmd(Date.now())} ${this.clock}  ${this.user.displayName}  ${stampPlace}`.trim();
            this.photo = await stampPhoto(path, stamp);
          } catch (e) {
            this.photoError = true;
            uni.showToast({ title: e.message || "照片处理失败", icon: "none" });
          } finally {
            uni.hideLoading();
          }
        },
        fail: (err) => {
          const msg = (err && err.errMsg) || "";
          if (msg.includes("cancel")) return; // 用户取消，不提示
          this.photoError = true;
          uni.showToast({ title: "无法打开摄像头，请允许相机权限", icon: "none" });
        },
      });
    },
    async doCheckin(type) {
      if (this.submitting) return;
      if (type === "on" && this.today.on) return;
      if (type === "off" && (!this.today.on || this.today.off)) return;

      const needPhoto = !this.today.rule || this.today.rule.need_photo !== false;
      if (needPhoto && !this.photo) {
        uni.showToast({ title: "请先拍摄打卡照片", icon: "none" });
        return;
      }
      // 与 PC 一致：规则允许时定位可以不提供（need_location === false）
      if (this.needLocation) {
        if (this.locStatus === "locating") {
          uni.showToast({ title: "正在获取定位，请稍候", icon: "none" });
          return;
        }
        if (this.locStatus !== "ok" || !this.locData) {
          uni.showToast({ title: "未获取到定位，请点「重新定位」", icon: "none" });
          return;
        }
      }

      this.submitting = true;
      try {
        const located = this.locStatus === "ok" && this.locData;
        const res = await submitCheckin({
          type,
          photo: this.photo,
          // 没定位就不传坐标；IP 兜底时把来源与凭证一起带上，后端要校验
          lat: located ? this.locData.lat : undefined,
          lng: located ? this.locData.lng : undefined,
          location_source: located ? this.locData.source : undefined,
          location_token: located ? this.locData.location_token : undefined,
          device_info: { model: "uni-app", ua: "uni-app" },
        });
        const fenceTip = res.fence_set && !res.in_fence ? `，超出打卡范围 ${fmtDistance(res.distance || 0)}` : "";
        uni.showToast({
          title: `${type === "on" ? "上班" : "下班"}打卡成功（${res.status_text}${fenceTip}）`,
          icon: "none",
          duration: 2600,
        });
        this.photo = "";
        await this.load();
      } catch (e) {
        uni.showToast({ title: e.message || "打卡失败，请重试", icon: "none", duration: 2600 });
      } finally {
        this.submitting = false;
      }
    },
    async openPhoto(record) {
      if (!record || !record.photo_url) return;
      const id = fileIdOf(record.photo_url);
      if (!id) {
        uni.showToast({ title: "照片地址无效", icon: "none" });
        return;
      }
      try {
        const link = await getFileLink(id);
        const url = link && (link.signed_url || link.url);
        if (!url) throw new Error("照片地址为空");
        uni.previewImage({ urls: [url] });
      } catch (e) {
        uni.showToast({ title: e.message || "照片打开失败", icon: "none" });
      }
    },
    goAttendance() {
      uni.navigateTo({ url: "/pages/attendance/index" });
    },
    back() {
      const pages = getCurrentPages();
      if (pages.length > 1) uni.navigateBack();
      else uni.reLaunch({ url: "/pages/work/index" });
    },
  },
};
</script>
