'use strict';
// 打卡 IP 定位兜底回归：桌面端 GPS 超时 → IP 定位 → 带凭证打卡
// 用法：node scripts/oa_checkin_ip_check.js
//
// 覆盖：
//   · 桌面端主进程传来了自己的公网 IP + 城市坐标时，后端直接采用（不查外部 IP 库）
//   · source=ip / accuracy=city / 签发 location_token
//   · IP 定位不参与 500m 围栏判定，也不显示"范围外"
//   · 伪造 source=ip 但无凭证必须被拒绝（否则可绕过严格围栏）
//   · 落库带 location_source / location_accuracy / client_ip，组长可审计
// 会临时给「王强」写一条打卡记录，跑完自动清理。
const { execSync } = require("child_process");
const crypto = require("crypto");

const BASE = "http://127.0.0.1:10010/oa/api/v1";
const SECRET = "chat123";
const UID = "9283941092";
const TODAY = new Date().toISOString().slice(0, 10);
const TEST_IP = "223.73.97.177"; // 深圳公网出口，仅用于查城市，不赋予任何权限
const TEST_LAT = 22.5455;
const TEST_LNG = 114.0683;
const TEST_ADDR = "中国广东深圳";

let pass = 0;
let fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) {
    pass += 1;
    console.log("PASS ", name, extra);
  } else {
    fail += 1;
    console.log("FAIL ", name, extra);
  }
};

function token(uid) {
  const b64 = (x) =>
    Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(
    JSON.stringify({ UserID: uid, Platform: "Web", exp: now + 86400, iat: now, nbf: now - 10 }),
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
const T = token(UID);

async function api(path, body) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", token: T },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

// 1x1 白色 JPEG，够走完「解码 → 落 MinIO」链路
const PHOTO =
  "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=";

function mongoEval(js) {
  return execSync(
    `docker exec mongo mongosh -u openIM -p openIM123 --authenticationDatabase openim_v3 openim_v3 --quiet --eval "${js}"`,
    { stdio: "pipe" },
  ).toString();
}
function cleanup() {
  try {
    mongoEval(
      `db.oa_checkin.deleteMany({user_id:'${UID}',date:'${TODAY}'}); db.oa_file.deleteMany({owner_id:'${UID}',scope:'checkin'}); print('cleaned')`,
    );
    console.log("· 已清理王强今日打卡记录");
  } catch (e) {
    console.log("· 清理失败（不影响结论）:", String(e.message).slice(0, 120));
  }
}

(async () => {
  cleanup();

  // 1. 桌面端路径：主进程查好坐标传上来，后端直接采用，不依赖外部 IP 库
  const ipRes = await api(
    `/checkin/locate-by-ip?ip=${TEST_IP}&lat=${TEST_LAT}&lng=${TEST_LNG}&address=${encodeURIComponent(TEST_ADDR)}`,
  );
  const d = ipRes.data || {};
  check("IP 定位接口返回成功", ipRes.code === 0, ipRes.msg || "");
  check("使用传入的客户端 IP", d.ip === TEST_IP, `实际 ${d.ip}`);
  check("来源标记为 ip", d.source === "ip", `实际 ${d.source}`);
  check("精度标记为 city", d.accuracy === "city", `实际 ${d.accuracy}`);
  check("采用客户端传来的坐标", d.lat === TEST_LAT && d.lng === TEST_LNG, `实际 ${d.lat},${d.lng}`);
  check("采用客户端传来的地址", d.address === TEST_ADDR, `实际 ${d.address}`);
  check("签发定位凭证", typeof d.location_token === "string" && d.location_token.includes("."));

  // 2. 带凭证提交：能打卡，且落库来源正确
  const submit = await api("/checkin/submit", {
    type: "on",
    photo: PHOTO,
    lat: d.lat,
    lng: d.lng,
    location_source: "ip",
    location_token: d.location_token,
    device_info: { model: "Desktop", ua: "oa_checkin_ip_check" },
  });
  check("IP 定位可以打卡", submit.code === 0, submit.msg || "");
  check("提交记录来源为 ip", submit.data?.location_source === "ip");
  check("提交记录精度为 city", submit.data?.location_accuracy === "city");
  check("IP 定位不计算围栏距离", submit.data?.distance === 0 && submit.data?.in_fence === false);

  // 3. 落库字段齐全（组长审计用）
  const raw = mongoEval(
    `printjson(db.oa_checkin.findOne({user_id:'${UID}',date:'${TODAY}',type:'on'}))`,
  );
  // mongosh 7 的 printjson 用单引号，别写死双引号正则
  check("落库 location_source=ip", /location_source: 'ip'/.test(raw));
  check("落库 location_accuracy=city", /location_accuracy: 'city'/.test(raw));
  check("落库 client_ip", /client_ip: '223\.73\.97\.177'/.test(raw));

  // 4. 清掉记录后测伪造：无凭证声明 source=ip 必须拒绝
  cleanup();
  const fake = await api("/checkin/submit", {
    type: "on",
    photo: PHOTO,
    lat: d.lat,
    lng: d.lng,
    location_source: "ip",
    location_token: "",
    device_info: { model: "Desktop", ua: "fake" },
  });
  check("无凭证不能伪装 IP 定位", fake.code !== 0, fake.msg || "");

  const tampered = await api("/checkin/submit", {
    type: "on",
    photo: PHOTO,
    lat: d.lat,
    lng: d.lng,
    location_source: "ip",
    location_token: `${d.location_token}x`,
    device_info: { model: "Desktop", ua: "tampered" },
  });
  check("篡改凭证不能打卡", tampered.code !== 0, tampered.msg || "");

  cleanup();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error("脚本异常：", e);
  cleanup();
  process.exit(1);
});
