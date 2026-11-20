import {
  AuditOutlined,
  CalendarOutlined,
  CameraOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import { App as AntdApp } from "antd";
import clsx from "clsx";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";

import OIMAvatar from "@/components/OIMAvatar";
import {
  getWorkbenchSummary,
  type WorkbenchCheckin,
  type WorkbenchReport,
  type WorkbenchSummary,
  type WorkbenchTodo,
} from "@/api/oaApi";
import { useUserStore } from "@/store";

import styles from "./index.module.scss";

const WORK_APPS = [
  { key: "checkin", name: "拍照打卡", icon: <CameraOutlined />, path: "/checkin" },
  { key: "report", name: "工作报告", icon: <FileTextOutlined />, path: "/report" },
  { key: "attendance", name: "出勤记录", icon: <ClockCircleOutlined />, path: "/attendance" },
  { key: "leave", name: "请假补卡", icon: <CalendarOutlined />, path: "/leave" },
  { key: "meeting", name: "线上会议", icon: <VideoCameraOutlined />, path: "" },
  { key: "approval", name: "审批中心", icon: <AuditOutlined />, path: "" },
  { key: "calendar", name: "工作日历", icon: <CalendarOutlined />, path: "" },
];

const EMPTY_CHECKIN: WorkbenchCheckin = {
  has_on: false,
  has_off: false,
  on_time: "",
  off_time: "",
  on_status: "",
  off_status: "",
  location: "",
  btn_text: "拍照打卡上班",
};

const EMPTY_REPORT: WorkbenchReport = { submitted: false, status: "", period: "" };

function getDateText() {
  const d = new Date();
  const weeks = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${d.getMonth() + 1}月${d.getDate()}日 ${weeks[d.getDay()]}`;
}

export const Work = () => {
  const { message } = AntdApp.useApp();
  const navigate = useNavigate();
  const selfInfo = useUserStore((state) => state.selfInfo);
  const [selected, setSelected] = useState<string>();
  const [todos, setTodos] = useState<WorkbenchTodo[]>([]);
  const [checkin, setCheckin] = useState<WorkbenchCheckin>(EMPTY_CHECKIN);
  const [report, setReport] = useState<WorkbenchReport>(EMPTY_REPORT);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data: WorkbenchSummary = await getWorkbenchSummary();
        if (!alive) return;
        setTodos(data.todos);
        setCheckin(data.checkin || EMPTY_CHECKIN);
        setReport(data.report || EMPTY_REPORT);
      } catch {
        // 工作台是首页，接口异常时不打断浏览，保留空态即可
        if (alive) setTodos([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const openApp = (key: string, name: string) => {
    setSelected(key);
    const app = WORK_APPS.find((a) => a.key === key);
    if (app?.path) {
      navigate(app.path);
      return;
    }
    message.info(`${name} 功能开发中`);
  };

  // 打卡卡片的副标题与主信息，全部来自真实打卡记录
  const checkinTip = checkin.has_on
    ? `上班卡 · ${checkin.on_status || "已打卡"}`
    : "今天还没打上班卡";
  const checkinTime = checkin.has_on ? checkin.on_time : "未打卡";
  const checkinPlace = checkin.has_on
    ? `上班 ${checkin.on_time}${checkin.location ? ` · ${checkin.location}` : ""}`
    : "打卡后才能记录出勤";

  return (
    <div className={styles["work-page"]}>
      <div className={styles["work-topbar"]}>
        <span className={styles["topbar-title"]}>工作台</span>
        <div className={styles["topbar-right"]}>
          <span className={styles["topbar-date"]}>
            {getDateText()} · {selfInfo.nickname || "同事"}
          </span>
          <OIMAvatar src={selfInfo.faceURL} text={selfInfo.nickname} size={28} />
        </div>
      </div>

      <div className={clsx(styles["work-scroll"], "mobile-bottom-space")}>
        <div className={styles["work-inner"]}>
          <div className={styles["checkin-card"]}>
            <div className={styles["checkin-main-col"]}>
              <div className={styles["checkin-head"]}>
                <span className={styles["checkin-title"]}>今日打卡</span>
                <span className={styles["checkin-date"]}>{checkinTip}</span>
              </div>
              <div className={styles["checkin-main"]}>
                <span className={styles["checkin-time"]}>{checkinTime}</span>
                <span className={styles["checkin-place"]}>{checkinPlace}</span>
              </div>
            </div>
            <div
              className={styles["checkin-photo"]}
              onClick={() => navigate("/checkin")}
            >
              <CameraOutlined />
              <span>{checkin.has_on ? `下班 ${checkin.off_time || "未打"}` : "去拍照打卡"}</span>
            </div>
            <div
              className={styles["checkin-btn"]}
              onClick={() => openApp("checkin", "拍照打卡")}
            >
              {checkin.btn_text}
            </div>
          </div>

          <div className={styles["work-row"]}>
            <div className={styles["todo-card"]}>
              <div className={styles["todo-head"]}>
                <span className={styles["todo-title"]}>待办</span>
                {todos.length > 0 && (
                  <span className={styles["todo-badge"]}>{todos.length}</span>
                )}
              </div>
              {todos.length === 0 ? (
                <div className={styles["todo-empty"]}>
                  <span className={styles["todo-empty-icon"]}>✓</span>
                  <span>
                    {report.submitted ? "今天的日报已提交" : "今天没有待办"}
                    {checkin.has_on && !checkin.has_off ? " · 记得下班打卡" : ""}
                  </span>
                </div>
              ) : (
                todos.map((todo) => (
                  <div
                    key={`${todo.key}-${todo.text}`}
                    className={styles["todo-row"]}
                    onClick={() => {
                      setSelected(todo.key);
                      navigate(todo.path);
                    }}
                  >
                    <span className={styles["todo-row-left"]}>
                      <span
                        className={styles["todo-dot"]}
                        style={{ background: todo.dot }}
                      />
                      {todo.text}
                    </span>
                    <span className={styles["todo-action"]}>{todo.action} ›</span>
                  </div>
                ))
              )}
            </div>

            <div className={styles["apps-card"]}>
              <div className={styles["apps-title"]}>常用应用</div>
              <div className={styles["apps-grid"]}>
                {WORK_APPS.map((app) => (
                  <div
                    key={app.key}
                    className={clsx(styles["app-item"], {
                      [styles["selected"]]: selected === app.key,
                    })}
                    onClick={() => openApp(app.key, app.name)}
                  >
                    <div className={styles["app-icon"]}>{app.icon}</div>
                    <div className={styles["app-name"]}>{app.name}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Work;
