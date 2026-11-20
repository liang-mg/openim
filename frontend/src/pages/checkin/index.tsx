import {
  ArrowLeftOutlined,
  CameraOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { App as AntdApp, Button, Spin, Tag } from "antd";
import clsx from "clsx";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  fileIdOf,
  getFileLink,
  getTodayCheckin,
  locateCheckin,
  locateCheckinByIp,
  submitCheckin,
  type CheckinRecord,
  type CheckinType,
  type LocateResult,
  type TodayCheckin,
} from "@/api/oaApi";
import {
  fmtDate,
  fmtDistance,
  fmtTime,
  ipLocationTag,
  placeText,
  statusColor,
  ymd,
} from "@/pages/checkin/utils";
import { useUserStore } from "@/store";

import styles from "./index.module.scss";

/** 定位状态：idle 未开始 / locating 定位中 / ok 已定位 / error 失败 */
type LocateState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ok"; data: LocateResult }
  | { status: "error"; message: string };

const MAX_PHOTO_BYTES = 300 * 1024;
const JPEG_PREFIX = "data:image/jpeg;base64,";

function encodeCheckinPhoto(canvas: HTMLCanvasElement): string | undefined {
  const smaller = document.createElement("canvas");
  const context = smaller.getContext("2d");
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    if (scale !== 1) {
      if (!context) return;
      smaller.width = Math.max(1, Math.round(canvas.width * scale));
      smaller.height = Math.max(1, Math.round(canvas.height * scale));
      context.drawImage(canvas, 0, 0, smaller.width, smaller.height);
    }
    const source = scale === 1 ? canvas : smaller;
    for (const quality of [0.85, 0.7, 0.55]) {
      const dataURL = source.toDataURL("image/jpeg", quality);
      if (!dataURL.startsWith(JPEG_PREFIX)) return;
      const padding = dataURL.endsWith("==") ? 2 : dataURL.endsWith("=") ? 1 : 0;
      const size = ((dataURL.length - JPEG_PREFIX.length) * 3) / 4 - padding;
      if (size > 0 && size <= MAX_PHOTO_BYTES) return dataURL;
    }
  }
}

function browserPlatform() {
  const browser = navigator as Navigator & { userAgentData?: { platform?: string } };
  return browser.userAgentData?.platform || browser.platform || undefined;
}

/** 浏览器定位失败原因翻译成人话，别直接把 DOMException 抛给用户 */
function geoErrText(err: GeolocationPositionError) {
  if (err.code === err.PERMISSION_DENIED) {
    return "定位权限被拒绝，请点地址栏左侧的图标允许「位置」后重试";
  }
  if (err.code === err.POSITION_UNAVAILABLE) {
    return "无法获取位置，请检查系统定位开关与网络";
  }
  if (err.code === err.TIMEOUT) {
    return "定位超时，请到空旷处或稍后重试";
  }
  return "获取位置失败，请重试";
}

export const Checkin = () => {
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const selfInfo = useUserStore((state) => state.selfInfo);

  const [today, setToday] = useState<TodayCheckin | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [photo, setPhoto] = useState<string>();
  const [loc, setLoc] = useState<LocateState>({ status: "idle" });
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const todayKey = ymd(now);

  // 打卡页只关心「今天」；整月出勤记录在 /attendance 独立页
  const refresh = async () => {
    setToday(await getTodayCheckin());
  };

  // 真实定位：系统 GPS 坐标 → 服务端换地址 + 算距离。
  // 桌面端没有 GPS 芯片，系统定位在国内 Windows 上基本都会超时，
  // 所以失败后自动降级到 IP 定位（城市级，不判 500m 围栏），不让员工卡在打卡页。
  const requestLocation = useCallback(() => {
    const fallbackToIp = async (reason: string) => {
      try {
        // 桌面端主进程直接查本机公网 IP + 城市坐标；网页端没这个 API，让后端自己查
        const hint = (await window.electronAPI?.getIpLocation?.()) || undefined;
        const data = await locateCheckinByIp(hint);
        setLoc({ status: "ok", data });
      } catch (e) {
        setLoc({
          status: "error",
          message: `${reason}；IP 定位也未成功：${
            e instanceof Error ? e.message : "请稍后重试"
          }`,
        });
      }
    };

    if (!navigator.geolocation) {
      void fallbackToIp("当前环境不支持系统定位");
      return;
    }
    setLoc({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await locateCheckin(pos.coords.latitude, pos.coords.longitude);
          setLoc({ status: "ok", data });
        } catch (e) {
          void fallbackToIp(e instanceof Error ? e.message : "定位解析失败");
        }
      },
      (err) => void fallbackToIp(geoErrText(err)),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const data = await getTodayCheckin();
        setToday(data);
        if (data.rule.need_location) requestLocation();
      } catch (e) {
        message.error(e instanceof Error ? e.message : "无法获取打卡规则");
      } finally {
        setLoading(false);
      }
    })();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const office = loc.status === "ok" ? loc.data.office : today?.office;
  const needPhoto = today?.rule.need_photo ?? true;
  const needLocation = today?.rule.need_location ?? true;

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraError(false);
      setCameraOn(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      }, 50);
    } catch {
      setCameraError(true);
      message.error("无法打开摄像头，请允许摄像头权限，或改用手机访问");
    }
  };

  const takePhoto = () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      message.warning("摄像头尚未就绪");
      return;
    }
    if (needLocation && loc.status !== "ok") {
      message.warning("请先获取当前位置，再拍摄打卡照片");
      return;
    }
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
    const w = (canvas.width = Math.max(1, Math.round(video.videoWidth * scale)));
    const h = (canvas.height = Math.max(1, Math.round(video.videoHeight * scale)));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    // 水印：时间 + 姓名 + 当前位置（配了地图 key 是街道地址，没配就是经纬度）
    const capturedAt = new Date();
    const stamp = `${ymd(capturedAt)} ${fmtTime(capturedAt.getTime())}  ${
      selfInfo.nickname || ""
    }`.trim();
    const stampPlace = loc.status === "ok"
      ? loc.data.address || `${loc.data.lat.toFixed(5)},${loc.data.lng.toFixed(5)}`
      : "";
    const fontSize = Math.min(28, Math.max(14, Math.round(w / 32)));
    const bandHeight = fontSize * 2 + 20;
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, h - bandHeight, w, bandHeight);
    ctx.fillStyle = "#fff";
    ctx.font = `${fontSize}px sans-serif`;
    const inset = Math.min(16, Math.floor(w / 4));
    ctx.fillText(stamp, inset, h - fontSize - 12, w - inset * 2);
    ctx.fillText(stampPlace, inset, h - 8, w - inset * 2);
    const compressed = encodeCheckinPhoto(canvas);
    if (!compressed) {
      message.error("无法生成 300 KiB 以内的打卡照片，请重新拍照");
      return;
    }
    setPhoto(compressed);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    setCameraOn(false);
  };

  // 打卡照片存在 MinIO，点开前换一个短期签名地址
  const openPhoto = async (record?: CheckinRecord | null) => {
    if (!record?.photo_url) return;
    const id = fileIdOf(record.photo_url);
    if (!id) {
      message.error("照片地址无效");
      return;
    }
    try {
      const link = await getFileLink(id);
      window.open(link.signed_url, "_blank", "noopener");
    } catch (e) {
      message.error(e instanceof Error ? e.message : "照片打开失败");
    }
  };

  const doCheckin = async (type: CheckinType) => {
    if (needPhoto && !photo) {
      message.warning("请先拍摄打卡照片");
      return;
    }
    if (needLocation && loc.status !== "ok") {
      message.warning(
        loc.status === "locating" ? "正在获取定位，请稍候" : "未获取到定位，请点「重新定位」",
      );
      return;
    }
    setSubmitting(true);
    try {
      const res = await submitCheckin({
        type,
        photo,
        lat: loc.status === "ok" ? loc.data.lat : undefined,
        lng: loc.status === "ok" ? loc.data.lng : undefined,
        location_source: loc.status === "ok" ? loc.data.source : undefined,
        location_token: loc.status === "ok" ? loc.data.location_token : undefined,
        device_info: {
          model: [window.electronAPI ? "Desktop" : "Web", browserPlatform()]
            .filter(Boolean)
            .join(" "),
          ua: navigator.userAgent,
        },
      });
      // IP 定位只有城市级精度，不判围栏，也不能显示"范围内/范围外"。
      const fenceTip =
        res.location_accuracy === "precise" && res.fence_set && !res.in_fence
          ? `，超出打卡范围 ${fmtDistance(res.distance || 0)}`
          : "";
      const sourceTip = res.location_source === "ip" ? "，IP 定位（城市级）" : "";
      message.success(
        `${type === "on" ? "上班" : "下班"}打卡成功（${res.status_text}${fenceTip}${sourceTip}）`,
      );
      setPhoto(undefined);
      await refresh();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "打卡失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const workingTime = `${String(now.getHours()).padStart(2, "0")}:${String(
    now.getMinutes(),
  ).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const fenceTag = () => {
    if (loc.status === "locating") return <Tag className={styles["fence-tag"]}>定位中</Tag>;
    if (loc.status === "error")
      return (
        <Tag color="red" className={styles["fence-tag"]}>
          未定位
        </Tag>
      );
    if (loc.status !== "ok") return null;
    // IP 定位只有城市级精度，不能冒充"打卡范围内"
    if (loc.data.accuracy === "city") {
      return (
        <Tag color="blue" className={styles["fence-tag"]}>
          IP 定位
        </Tag>
      );
    }
    // 没配打卡点就没有「范围」可言，别硬造一个「正常」出来
    if (!loc.data.fence_set) {
      return (
        <Tag color="blue" className={styles["fence-tag"]}>
          已定位
        </Tag>
      );
    }
    return (
      <Tag color={loc.data.in_fence ? "green" : "orange"} className={styles["fence-tag"]}>
        {loc.data.in_fence ? "打卡范围内" : "超出打卡范围"}
      </Tag>
    );
  };

  const locationBody = () => {
    if (loc.status === "locating") {
      return (
        <div className={styles["location-sub"]}>
          <Spin size="small" /> 正在获取当前位置…
        </div>
      );
    }
    if (loc.status === "error") {
      return (
        <>
          <div className={styles["location-sub"]}>{loc.message}</div>
          <div className={styles["location-meta"]}>
            <a onClick={requestLocation}>重新定位</a>
          </div>
        </>
      );
    }
    if (loc.status === "ok") {
      const { distance, address, lat, lng, fence_set, accuracy, ip } = loc.data;
      if (accuracy === "city") {
        return (
          <>
            <div className={styles["location-sub"]}>
              IP 定位（城市级），不判定打卡范围{address ? ` · ${address}` : ""}
            </div>
            <div className={styles["location-meta"]}>
              {ip ? `公网 IP ${ip} · ` : ""}
              <a onClick={requestLocation}>重新定位</a>
            </div>
          </>
        );
      }
      return (
        <>
          <div className={styles["location-sub"]}>
            {fence_set ? `距打卡点 ${fmtDistance(distance)}` : "已记录当前坐标"}
            {address ? ` · ${address}` : ""}
          </div>
          <div className={styles["location-meta"]}>
            {lat.toFixed(5)}, {lng.toFixed(5)} · <a onClick={requestLocation}>重新定位</a>
          </div>
        </>
      );
    }
    return (
      <div className={styles["location-meta"]}>
        {needLocation ? "" : "本规则允许不提供定位 · "}
        <a onClick={requestLocation}>获取定位</a>
      </div>
    );
  };

  return (
    <div className={styles["checkin-page"]}>
      <div className={styles["checkin-topbar"]}>
        <div className={styles["topbar-left"]}>
          <ArrowLeftOutlined onClick={() => navigate("/work")} />
          <span>拍照打卡</span>
        </div>
        <span className={styles["topbar-user"]}>{selfInfo.nickname || "同事"}</span>
      </div>

      <Spin spinning={loading}>
        <div className={styles["checkin-body"]}>
          <div className={styles["op-column"]}>
            <div className={styles["clock-card"]}>
              <div className={styles["clock-date"]}>{fmtDate(todayKey)}</div>
              <div className={styles["clock-time"]}>{workingTime}</div>
              <div className={styles["clock-tip"]}>
                <ClockCircleOutlined /> 打卡时间以服务端为准
              </div>
            </div>

            <div className={styles["op-card"]}>
              <div className={styles["op-card-title"]}>{needPhoto ? "现场拍照" : "现场拍照（选填）"}</div>
              <div className={styles["photo-box"]}>
                {cameraOn ? (
                  <video
                    ref={videoRef}
                    className={styles["camera-video"]}
                    muted
                    playsInline
                  />
                ) : photo ? (
                  <img src={photo} alt="打卡照片" className={styles["photo-preview"]} />
                ) : (
                  <div className={styles["photo-placeholder"]}>
                    <CameraOutlined />
                    <span>{cameraError ? "摄像头不可用" : "点击拍照"}</span>
                  </div>
                )}
              </div>
              <div className={styles["op-actions"]}>
                {!cameraOn ? (
                  <Button icon={<CameraOutlined />} onClick={startCamera}>
                    {photo ? "重新拍照" : "打开摄像头"}
                  </Button>
                ) : (
                  <Button type="primary" icon={<CameraOutlined />} onClick={takePhoto}>
                    拍摄
                  </Button>
                )}
                {cameraOn && (
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      streamRef.current?.getTracks().forEach((t) => t.stop());
                      setCameraOn(false);
                    }}
                  >
                    关闭
                  </Button>
                )}
              </div>

              <div className={styles["location-box"]}>
                <div className={styles["location-head"]}>
                  <EnvironmentOutlined />
                  <span className={styles["location-title"]}>{office?.name || "当前位置"}</span>
                  {fenceTag()}
                </div>
                {locationBody()}
              </div>
            </div>

            <div className={styles["submit-row"]}>
              <Button
                type="primary"
                size="large"
                block
                loading={submitting}
                disabled={!today || cameraOn || Boolean(today.on)}
                onClick={() => doCheckin("on")}
              >
                {today?.on ? "上班已打卡" : "提交上班卡"}
              </Button>
              <Button
                size="large"
                block
                loading={submitting}
                disabled={!today || cameraOn || Boolean(today.off) || !today.on}
                onClick={() => doCheckin("off")}
              >
                {today?.off ? "下班已打卡" : "提交下班卡"}
              </Button>
            </div>
          </div>

          <div className={styles["record-column"]}>
            <div className={styles["record-card"]}>
              <div className={styles["record-title"]}>今日打卡</div>
              <div className={styles["timeline"]}>
                <div className={clsx(styles["timeline-item"], { [styles["done"]]: today?.on })}>
                  <span className={styles["timeline-dot"]} />
                  <div className={styles["timeline-body"]}>
                    <div className={styles["timeline-head"]}>
                      <span>上班卡</span>
                      {today?.on ? (
                        <Tag color={statusColor[today.on.status]}>{today.on.status_text}</Tag>
                      ) : (
                        <span className={styles["pending"]}>未打卡</span>
                      )}
                    </div>
                    <div className={styles["timeline-time"]}>
                      {fmtTime(today?.on?.checkin_time)}
                      {ipLocationTag(today?.on) && (
                        <Tag color="blue" className={styles["fence-tag"]}>
                          IP 定位
                        </Tag>
                      )}
                      {today?.on?.location_accuracy === "precise" &&
                        today.on.fence_set &&
                        !today.on.in_fence &&
                        !!today.on.distance && (
                          <span className={styles["out-fence"]}>
                            范围外 {fmtDistance(today.on.distance)}
                          </span>
                        )}
                      {today?.on?.photo_url && (
                        <span className={styles["photo-link"]} onClick={() => openPhoto(today.on)}>
                          查看照片
                        </span>
                      )}
                    </div>
                    {placeText(today?.on) && (
                      <div className={styles["timeline-addr"]}>{placeText(today?.on)}</div>
                    )}
                  </div>
                </div>
                <div className={clsx(styles["timeline-item"], { [styles["done"]]: today?.off })}>
                  <span className={styles["timeline-dot"]} />
                  <div className={styles["timeline-body"]}>
                    <div className={styles["timeline-head"]}>
                      <span>下班卡</span>
                      {today?.off ? (
                        <Tag color={statusColor[today.off.status]}>{today.off.status_text}</Tag>
                      ) : (
                        <span className={styles["pending"]}>未打卡</span>
                      )}
                    </div>
                    <div className={styles["timeline-time"]}>
                      {fmtTime(today?.off?.checkin_time)}
                      {ipLocationTag(today?.off) && (
                        <Tag color="blue" className={styles["fence-tag"]}>
                          IP 定位
                        </Tag>
                      )}
                      {today?.off?.location_accuracy === "precise" &&
                        today.off.fence_set &&
                        !today.off.in_fence &&
                        !!today.off.distance && (
                          <span className={styles["out-fence"]}>
                            范围外 {fmtDistance(today.off.distance)}
                          </span>
                        )}
                      {today?.off?.photo_url && (
                        <span className={styles["photo-link"]} onClick={() => openPhoto(today.off)}>
                          查看照片
                        </span>
                      )}
                    </div>
                    {placeText(today?.off) && (
                      <div className={styles["timeline-addr"]}>{placeText(today?.off)}</div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <a
              className={styles["to-attendance"]}
              onClick={() => navigate("/attendance")}
            >
              查看本月出勤记录 →
            </a>
          </div>
        </div>
      </Spin>
    </div>
  );
};

export default Checkin;
