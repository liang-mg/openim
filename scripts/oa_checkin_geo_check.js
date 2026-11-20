'use strict';
// 打卡定位回归：真实坐标 → 地址/距离/范围判定，且「没有定位就打不了卡」
// 用法：node scripts/oa_checkin_geo_check.js
//
// 两套环境都通过：
//   · 没配打卡点（默认）—— 只记录真实坐标，不判范围，fence_set=false
//   · 配了打卡点（.env 填 XINBO_OA_OFFICE_*）—— 额外校验距离与范围判定
// 会临时给「王强」写两条打卡记录，跑完自动清理，不留脏数据。
const { execSync } = require("child_process");

const BASE = "http://127.0.0.1:10010/oa/api/v1";
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const UID = "9283941092"; // 王强，平时不打卡，拿来做写入测试
const TODAY = new Date().toISOString().slice(0, 10);
const NEAR = { lat: 22.5408, lng: 113.9347 };
const FAR = { lat: 22.551, lng: 113.95 };

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

const crypto = require("crypto");
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

function cleanup() {
  // Windows 下 execSync 走 cmd.exe：外层用双引号、JS 字符串用单引号才不会被打断
  const js = `db.oa_checkin.deleteMany({user_id:'${UID}',date:'${TODAY}'}); db.oa_file.deleteMany({owner_id:'${UID}',scope:'checkin'}); print('cleaned')`;
  try {
    execSync(
      `docker exec mongo mongosh -u openIM -p ${process.env.MONGO_PASSWORD || "<CHANGE_ME_MONGO_PASSWORD>"} --authenticationDatabase openim_v3 openim_v3 --quiet --eval "${js}"`,
      { stdio: "pipe" },
    );
    console.log("· 已清理王强今日打卡记录");
  } catch (e) {
    console.log("· 清理失败（不影响结论）:", String(e.message).slice(0, 120));
  }
}

(async () => {
  cleanup();

  // 1. today 接口必须下发打卡点信息，且默认不预设公司名/地址
  const t = await api("/checkin/today");
  const office = t.data?.office || {};
  const configured = office.configured === true;
  console.log(
    configured
      ? `· 已配置打卡点：${office.name || "(未命名)"} ${office.lat},${office.lng} 半径 ${office.radius}m`
      : "· 未配置打卡点：只记录坐标，不判范围",
  );
  check("today 返回打卡点结构", t.code === 0 && typeof office.configured === "boolean");
  check(
    "不预设公司名/地址",
    configured ? !!office.name : office.name === "" && office.address === "",
    JSON.stringify({ name: office.name, address: office.address }),
  );

  // 2. 定位解析
  const near = await api(`/checkin/locate?lat=${NEAR.lat}&lng=${NEAR.lng}`);
  check("定位解析成功", near.code === 0 && near.data.lat === NEAR.lat && near.data.lng === NEAR.lng);
  check("fence_set 与配置一致", near.data?.fence_set === configured);
  const far = await api(`/checkin/locate?lat=${FAR.lat}&lng=${FAR.lng}`);
  if (configured) {
    check("近距在半径内", near.data.in_fence === true && near.data.distance > 0, `${near.data.distance}m`);
    check("远距判定范围外", far.data.in_fence === false, `${far.data.distance}m`);
    check("距离计算合理（1.5~2.5km）", far.data.distance > 1500 && far.data.distance < 2500);
  } else {
    console.log("SKIP 范围判定依赖打卡点配置，本次只校验坐标记录");
  }

  const bad = await api(`/checkin/locate?lat=abc&lng=1`);
  check("非法坐标被拒", bad.code !== 0);

  // 3. 没有定位、没有照片都不允许打卡
  const noGeo = await api("/checkin/submit", { type: "on", photo: PHOTO });
  check("无定位拒绝打卡", noGeo.code !== 0 && /定位/.test(noGeo.msg || ""), noGeo.msg);
  const noPhoto = await api("/checkin/submit", { type: "on", ...NEAR });
  check("无照片拒绝打卡", noPhoto.code !== 0 && /照片/.test(noPhoto.msg || ""), noPhoto.msg);

  // 4. 带真实坐标打卡：服务端要落 lat/lng 与 fence_set
  const on = await api("/checkin/submit", { type: "on", photo: PHOTO, ...NEAR });
  check("带定位上班卡成功", on.code === 0, on.msg);
  check("记录写入真实坐标", on.data?.lat === NEAR.lat && on.data?.lng === NEAR.lng);
  check("记录写入范围判定标记", on.data?.fence_set === configured);
  check("照片已入 MinIO", !!on.data?.photo_url);
  if (configured) {
    check("记录写入距离与范围", on.data.in_fence === true && on.data.distance > 0, `${on.data.distance}m`);
    check("定位点名称取配置", on.data.location_name === office.name, on.data.location_name);
  }

  const off = await api("/checkin/submit", { type: "off", photo: PHOTO, ...FAR });
  check("范围外打卡（非严格模式）仍可提交", off.code === 0, off.msg);
  check("范围外记录带标记", off.data?.fence_set === configured && off.data?.distance >= 0);

  // 5. 列表回显
  const list = await api(`/checkin/list?month=${TODAY.slice(0, 7)}`);
  const mine = (list.data?.list || []).filter((r) => r.date === TODAY);
  check("本月记录含今日两条", mine.length === 2, `count=${mine.length}`);
  check("列表带出距离字段", mine.every((r) => typeof r.distance === "number"));

  cleanup();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
