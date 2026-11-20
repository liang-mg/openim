'use strict';
// 造本月打卡演示数据（只给「李然」），用来看出勤日历的分状态展示。
// 用法：node scripts/oa_seed_checkin_month.js [YYYY-MM]
//   · 只写工作日；留 1 天整天缺卡、1 天只打上班卡，模拟真实的漏卡情况
//   · 今天只写入上班卡，方便继续演示「提交下班卡」
//   · 今天的记录挂一张真实照片（走 /files/upload），历史记录不带照片
// 清理：node scripts/oa_seed_checkin_month.js --clean [YYYY-MM]
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const API = "http://127.0.0.1:10010/oa/api/v1";
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const MONGO_PW = process.env.MONGO_PASSWORD || '<CHANGE_ME_MONGO_PASSWORD>';
const UID = "2158780278"; // 李然
const COMPANY = "xinbo";
const MONGO = "docker exec -i mongo mongosh -u openIM -p " + MONGO_PW + " --authenticationDatabase openim_v3 openim_v3 --quiet";

function token() {
  const b64 = (x) =>
    Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(
    JSON.stringify({ UserID: UID, Platform: "Web", exp: now + 86400, iat: now, nbf: now - 10 }),
  );
  const s = crypto
    .createHmac("sha256", SECRET)
    .update(`${h}.${p}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${h}.${p}.${s}`;
}

function runMongo(js) {
  const file = path.join(os.tmpdir(), `oa_seed_ck_${Date.now()}.js`);
  fs.writeFileSync(file, js, "utf8");
  try {
    const out = execSync(
      `docker exec -i mongo mongosh -u openIM -p ${process.env.MONGO_PASSWORD || "<CHANGE_ME_MONGO_PASSWORD>"} --authenticationDatabase openim_v3 openim_v3 --quiet < "${file}"`,
      { encoding: "utf8" },
    );
    return out.trim();
  } finally {
    fs.unlinkSync(file);
  }
}

const ym = process.argv.find((a) => /^\d{4}-\d{2}$/.test(a)) || "";
const month = ym || (() => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
})();

if (process.argv.includes("--clean")) {
  console.log(
    runMongo(
      `print('deleted:' + db.oa_checkin.deleteMany({company_id:'${COMPANY}', user_id:'${UID}', date:/^${month}/}).deletedCount)`,
    ),
  );
  process.exit(0);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function ts(y, m, d, hh, mm) {
  return new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
}

(async () => {
  const [y, m] = month.split("-").map(Number);
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const days = new Date(y, m, 0).getDate();

  // 今天那一张照片：先走真实上传接口，历史记录就不挂照片了
  let photo = null;
  if (todayKey.startsWith(month)) {
    const tmp = path.join(os.tmpdir(), "oa_seed_checkin.jpg");
    fs.writeFileSync(
      tmp,
      Buffer.from(
        "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
        "base64",
      ),
    );
    const form = new FormData();
    form.append("file", new Blob([fs.readFileSync(tmp)], { type: "image/jpeg" }), "打卡照片.jpg");
    form.append("scope", "checkin");
    const r = await fetch(`${API}/files/upload`, {
      method: "POST",
      headers: { token: token() },
      body: form,
    });
    const j = await r.json();
    if (j.code === 0) photo = j.data;
    else console.log("· 照片上传失败，今日记录不带照片:", j.msg);
    fs.unlinkSync(tmp);
  }

  const docs = [];
  const push = (date, type, ms, status, text, photoMeta) => {
    docs.push({
      checkin_id: `ck_${UID}_${date}_${type}`,
      company_id: COMPANY,
      user_id: UID,
      date,
      type,
      checkin_time: ms,
      photo_url: photoMeta ? `/oa/api/v1/files/${photoMeta.file_id}` : undefined,
      photo_file_id: photoMeta ? photoMeta.file_id : undefined,
      location_name: "",
      lat: 22.5408,
      lng: 113.9347,
      distance: 0,
      in_fence: false,
      fence_set: false,
      device: "Web | seed",
      status,
      status_text: text,
      created_at: ms,
    });
  };

  for (let d = 1; d <= days; d += 1) {
    const date = `${month}-${pad(d)}`;
    if (date > todayKey) break;
    const wd = new Date(y, m - 1, d).getDay();
    if (wd === 0 || wd === 6) continue;
    if (date === `${month}-05`) continue; // 整天缺卡
    const isToday = date === todayKey;

    const late = date === `${month}-10`;
    const early = date === `${month}-03`;
    const onH = late ? 9 : 8;
    const onM = late ? 42 : 46 + ((d * 3) % 11);
    push(date, "on", ts(y, m, d, onH, onM), late ? "late" : "normal", late ? "迟到" : "正常",
      isToday ? photo : null);

    if (date === `${month}-12`) continue; // 只打上班卡
    if (isToday) continue; // 今天留给自己点「提交下班卡」
    const offH = early ? 17 : 18;
    const offM = early ? 20 : 4 + ((d * 7) % 26);
    push(date, "off", ts(y, m, d, offH, offM), early ? "early" : "normal", early ? "早退" : "正常", null);
  }

  const js = `
    const docs = ${JSON.stringify(docs)};
    const del = db.oa_checkin.deleteMany({company_id:'${COMPANY}', user_id:'${UID}', date:/^${month}/});
    const ins = db.oa_checkin.insertMany(docs);
    print('deleted:' + del.deletedCount + ' inserted:' + docs.length);
  `;
  console.log(runMongo(js));
  console.log(`· ${month} 共 ${docs.length} 条（工作日 ${docs.length / 2 | 0} 天左右，含 1 天缺卡 / 1 天缺下班卡 / 1 次迟到 / 1 次早退）`);
})();
