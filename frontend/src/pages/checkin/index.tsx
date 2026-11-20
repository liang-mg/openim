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
  submitCheckin,
  type CheckinRecord,
  type CheckinType,
  type LocateResult,
  type TodayCheckin,
} from "@/api/oaApi";
import { fmtDate, fmtDistance, fmtTime, placeText, statusColor, ymd } from "@/pages/checkin/utils";
import { useUserStore } from "@/store";

import styles from "./index.module.scss";

/** 定位状态：idle 未开始 / locating 定位中 / ok 已定位 / error 失败 */
type LocateState =
  | { status: "idle" }
  | { status: "locating" }
  | { status: "ok"; data: LocateResult }
  | { status: "error"; message: string };

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

  // 真实定位：浏览器 GPS 坐标 → 服务端换地址 + 算距离。
  // 必须由用户手势或页面加载触发，且页面要在 HTTPS（或 localhost）下才有权限。
  const requestLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLoc({ status: "error", message: "当前浏览器不支持定位，请更换浏览器" });
      return;
    }
    setLoc({ status: "locating" });
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const data = await locateCheckin(pos.coords.latitude, pos.coords.longitude);
          setLoc({ status: "ok", data });
        } catch (e) {
          setLoc({
            status: "error",
            message: e instanceof Error ? e.message : "定位解析失败，请重试",
          });
        }
      },
      (err) => setLoc({ status: "error", message: geoErrText(err) }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        setToday(await getTodayCheckin());
      } finally {
        setLoading(false);
      }
    })();
    requestLocation();
    return () => streamRef.current?.getTracks().forEach((t) => t.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const office = loc.status === "ok" ? loc.data.office : today?.office;

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
    if (!video || !video.videoWidth) {
      message.warning("摄像头尚未就绪");
      return;
    }
    const canvas = document.createElement("canvas");
    const w = (canvas.width = video.videoWidth);
    const h = (canvas.height = video.videoHeight);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);
    // 水印：时间 + 姓名 + 当前位置（配了地图 key 是街道地址，没配就是经纬度）
    const stampPlace =
      loc.status === "ok"
        ? loc.data.address || `${loc.data.lat.toFixed(5)},${loc.data.lng.toFixed(5)}`
        : "";
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
      now.getDate(),
    ).padStart(2, "0")} ${fmtTime(now.getTime())}  ${selfInfo.nickname || ""}  ${stampPlace}`.trim();
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, h - 56, w, 56);
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(14, Math.round(w / 26))}px sans-serif`;
    ctx.fillText(stamp.length > 42 ? `${stamp.slice(0, 42)}…` : stamp, 16, h - 20);
    setPhoto(canvas.toDataURL("image/jpeg", 0.8));
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
    if (!photo) {
      message.warning("请先拍摄打卡照片");
      return;
    }
    if (loc.status !== "ok") {
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
        lat: loc.data.lat,
        lng: loc.data.lng,
        device_info: { model: "Web", ua: navigator.userAgent },
      });
      const fenceTip =
        res.fence_set && !res.in_fence ? `，超出打卡范围 ${fmtDistance(res.distance || 0)}` : "";
      message.success(`${type === "on" ? "上班" : "下班"}打卡成功（${res.status_text}${fenceTip}）`);
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
      const { distance, address, lat, lng, fence_set } = loc.data;
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
    return null;
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
              <div className={styles["op-card-title"]}>现场拍照</div>
              <div className={styles["photo-box"]}>
                {photo ? (
                  <img src={photo} alt="打卡照片" className={styles["photo-preview"]} />
                ) : cameraOn ? (
                  <video ref={videoRef} className={styles["camera-video"]} muted playsInline />
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
                disabled={!!today?.on}
                onClick={() => doCheckin("on")}
              >
                {today?.on ? "上班已打卡" : "提交上班卡"}
              </Button>
              <Button
                size="large"
                block
                loading={submitting}
                disabled={!!today?.off || !today?.on}
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
                      {today?.on?.fence_set && !today.on.in_fence && !!today.on.distance && (
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
                      {today?.off?.fence_set && !today.off.in_fence && !!today.off.distance && (
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
