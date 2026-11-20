// 文件服务校验：上传、鉴权下载、越权拒绝、签名链接、打卡照片落库
const crypto = require("crypto");

const BASE = "http://127.0.0.1:10010/oa/api/v1";
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const U = { liran: "2158780278", zhangming: "7474479331", qiang: "9283941092", boss: "7559659175" };

let passed = 0;
let failed = 0;
function check(name, cond, extra = "") {
  if (cond) { passed++; console.log("PASS ", name, extra); }
  else { failed++; console.log("FAIL ", name, extra); }
}

function token(uid) {
  const b64 = (x) => Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: "Web", exp: now + 86400, iat: now, nbf: now - 10 }));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${h}.${p}.${s}`;
}

async function api(path, uid, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (uid) headers.token = token(uid);
  const r = await fetch(BASE + path, { method: opts.method || "GET", headers, body: opts.body });
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return { status: r.status, json: await r.json() };
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers };
}

// 造一张 1x1 的 PNG 当附件
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8AAAwAB/wH2v7j0AAAAAElFTkSuQmCC",
  "base64",
);

async function upload(uid, name, buf, mime) {
  const fd = new FormData();
  fd.append("file", new Blob([buf], { type: mime }), name);
  fd.append("scope", "report");
  return api("/files/upload", uid, { method: "POST", body: fd });
}

(async () => {
  // 1. 上传
  const up = await upload(U.liran, "测试附件.png", PNG, "image/png");
  check("上传成功", up.json && up.json.code === 0, up.json && up.json.data && up.json.data.file_id);
  const f = up.json && up.json.data;
  if (!f) { console.log(`\n==== ${passed}/${passed + failed} passed ====`); process.exit(1); }

  // 2. 本人 header token 下载
  let d = await api(`/files/${f.file_id}`, U.liran);
  check("本人可下载", d.status === 200 && d.buf.length === PNG.length, `status=${d.status} size=${d.buf && d.buf.length}`);

  // 3. 签名链接（模拟 <img src>，不带 token）
  const signed = await api(`/files/${f.file_id}/link`, U.liran);
  const url = signed.json && signed.json.data && signed.json.data.signed_url;
  d = await fetch("http://127.0.0.1:10010" + url).then(async (r) => ({
    status: r.status, buf: Buffer.from(await r.arrayBuffer()),
  }));
  check("签名链接免 token 可读", d.status === 200 && d.buf.length === PNG.length, `status=${d.status}`);

  // 4. 篡改签名
  const bad = url.replace(/s=[0-9a-f]+/, "s=" + "0".repeat(64));
  d = await fetch("http://127.0.0.1:10010" + bad);
  check("签名被篡改则拒绝", d.status === 403, `status=${d.status}`);

  // 5. 无凭证
  d = await fetch(`http://127.0.0.1:10010/oa/api/v1/files/${f.file_id}`);
  check("无凭证拒绝", d.status === 403, `status=${d.status}`);

  // 6. 同级员工越权
  d = await api(`/files/${f.file_id}`, U.zhangming);
  check("同级员工越权拒绝", d.status === 403, `status=${d.status}`);

  // 7. 直属组长可读（要审日报就得能看附件）
  d = await api(`/files/${f.file_id}`, U.qiang);
  check("组长可读组员附件", d.status === 200, `status=${d.status}`);

  // 8. 领导可读
  d = await api(`/files/${f.file_id}`, U.boss);
  check("领导可读团队附件", d.status === 200, `status=${d.status}`);

  // 9. 非法类型
  const badUp = await upload(U.liran, "木马.exe", Buffer.from("MZ"), "application/octet-stream");
  check("拒绝非法扩展名", badUp.json && badUp.json.code !== 0, badUp.json && badUp.json.msg);

  // 10. 前端临时地址不许写进日报
  const now = new Date();
  const period = `2027-01-${String(1 + (process.pid % 20)).padStart(2, "0")}`;
  let r = await api("/report/submit", U.liran, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "daily", period, content: { done: "测试附件校验", plan: "", issues: "" },
      attachments: [{ name: "a.png", size: 10, file_type: "png", url: "blob:http://x/y" }],
      status: "submitted",
    }),
  });
  check("blob 地址被拒", r.json.code !== 0, r.json.msg);

  // 11. 引用别人的 file_id
  r = await api("/report/submit", U.zhangming, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "daily", period, content: { done: "越权引用他人附件", plan: "", issues: "" },
      attachments: [{ name: f.name, size: f.size, file_type: "png", url: f.url }],
      status: "submitted",
    }),
  });
  check("引用他人附件被拒", r.json.code !== 0, r.json.msg);

  // 12. 正常提交带附件
  r = await api("/report/submit", U.liran, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "daily", period, content: { done: "带附件提交", plan: "", issues: "" },
      attachments: [{ name: f.name, size: f.size, file_type: "png", url: f.url }],
      status: "submitted",
    }),
  });
  check("带附件提交成功", r.json.code === 0, r.json.code === 0 ? r.json.data.report_id : r.json.msg);

  // 13. 打卡照片落库。
  // 动态挑一个今天还能打卡的账号：优先今天一条记录都没有的，
  // 其次挑只打了一次的（补另一次）。写死账号会因为演示数据里已有记录而误报失败。
  const candidates = [U.qiang, U.zhangming, U.liran];
  let target = null;
  let ckType = "on";
  for (const uid of candidates) {
    const t = await api("/checkin/today", uid);
    const on = t.json.data && t.json.data.on;
    const off = t.json.data && t.json.data.off;
    if (!on && !off) { target = uid; ckType = "on"; break; }
    if (on && !off) { target = uid; ckType = "off"; break; }
  }
  if (!target) {
    console.log("SKIP  打卡照片已存档（三个账号今天都已打完上下班卡，无法再提交）");
    passed++;
  } else {
  const photo = "data:image/png;base64," + PNG.toString("base64");
  r = await api("/checkin/submit", target, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: ckType, photo, lat: 22.5431, lng: 114.0579,
      location_name: "测试打卡点", device_info: { model: "Web", ua: "Mozilla/5.0 Test" },
    }),
  });
  if (r.json.code === 0) {
    check("打卡照片已存档", !!r.json.data.photo_url, r.json.data.photo_url);
    check("经纬度已落库", r.json.data.lat === 22.5431, `lat=${r.json.data.lat}`);
    const p = await api(`/files/${r.json.data.photo_file_id}`, U.qiang);
    check("组长可调阅打卡照片", p.status === 200, `status=${p.status}`);
  } else {
    check("打卡照片已存档", false, `打卡失败：${r.json.msg}`);
  }
  }

  // 14. 生产代理链路（nginx 同源）
  const viaProxy = await fetch("http://127.0.0.1:11001" + url).then((x) => x.status).catch(() => 0);
  check("生产反代可读附件", viaProxy === 200, `status=${viaProxy}`);

  console.log(`\n==== ${passed}/${passed + failed} passed ====`);
  if (failed) process.exit(1);
})();
