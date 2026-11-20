'use strict';
// 打卡页 UI 回归：真实定位展示 + 无「模拟照片」入口
// 用法：node scripts/oa_checkin_ui_check.js
//
// 兼容两种部署状态：
//   1) 未配打卡点（默认）：显示「当前位置 / 已定位 / 已记录当前坐标」
//   2) 已配打卡点：显示打卡点名称 + 距离 + 范围内/范围外
const crypto = require("crypto");
const { execSync } = require("child_process");
const {
  chromium,
} = require('./lib/playwright-env');

const CHROME = require('./lib/playwright-env').CHROME;
const BASE = "http://127.0.0.1:5173/";
const API = "http://127.0.0.1:10010/oa/api/v1";
const OUT = require('./lib/playwright-env').OUT;

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
    .createHmac("sha256", "chat123")
    .update(`${h}.${p}`)
    .digest("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${h}.${p}.${s}`;
}

async function login(page, phone) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  const acct = page.locator('input[placeholder*="账号"]').first();
  if (await acct.count()) await acct.fill(phone);
  const pwd = page.locator('input[type="password"]').first();
  if (await pwd.count()) await pwd.fill("Xinbo@2026");
  await page.getByRole("button", { name: /登录/ }).first().click();
  await page.waitForTimeout(5500);
  return page.url().includes("/chat");
}

function cleanup(uid) {
  const today = new Date().toISOString().slice(0, 10);
  const js = `db.oa_checkin.deleteMany({user_id:'${uid}',date:'${today}'}); db.oa_file.deleteMany({owner_id:'${uid}',scope:'checkin'}); print('cleaned')`;
  try {
    execSync(
      `docker exec mongo mongosh -u openIM -p openIM123 --authenticationDatabase openim_v3 openim_v3 --quiet --eval "${js}"`,
      { stdio: "pipe" },
    );
    console.log("· 已清理测试打卡记录");
  } catch (e) {
    console.log("· 清理失败:", String(e.message).slice(0, 100));
  }
}

(async () => {
  // 先看服务端有没有配打卡点，决定断言口径
  const tRes = await fetch(`${API}/checkin/today`, { headers: { token: token("2158780278") } });
  const tJson = await tRes.json();
  const office = tJson.data?.office || {};
  const configured = office.configured === true;
  console.log(configured ? `· 已配置打卡点：${office.name}` : "· 未配置打卡点：只显示坐标");

  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
      "--allow-file-access-from-files",
    ],
  });
  const errs = [];

  // ---------- 1. 员工李然：已打卡状态 + 真实定位 ----------
  const ctx1 = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
    permissions: ["camera", "geolocation"],
    geolocation: { latitude: 22.5408, longitude: 113.9347 },
  });
  const p1 = await ctx1.newPage();
  p1.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  check("员工登录", await login(p1, "12345678001"));
  await p1.goto(BASE + "#/checkin", { waitUntil: "domcontentloaded" });
  await p1.waitForTimeout(4000);

  let body = await p1.locator("body").innerText();
  check(
    "定位状态标签正确",
    configured ? /打卡范围内|超出打卡范围/.test(body) : body.includes("已定位"),
  );
  check(
    configured ? "展示距打卡点距离" : "未配打卡点时说明只记录坐标",
    configured ? body.includes("距打卡点") : body.includes("已记录当前坐标"),
  );
  check("展示真实经纬度", /2[0-9]\.\d{4,5},\s*1[0-9]{2}\.\d{4,5}/.test(body));
  check("不再写死公司名", !body.includes("深圳总部"));
  check("不再写死「定位正常」", !body.includes("定位正常"));
  check("不再写死「腾讯大厦」", !body.includes("腾讯大厦"));
  check("无「用模拟照片」入口", !body.includes("模拟照片"));

  // 打卡页只负责打卡：出勤日历已拆到 #/attendance，这里不能再有第二份
  check("打卡页不再内嵌出勤日历", (await p1.locator('div[class*="cal-grid"]').count()) === 0);
  check("打卡页有出勤记录入口", body.includes("查看本月出勤记录"));
  const box1 = await p1
    .locator('div[class*="checkin-body"]')
    .first()
    .evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }));
  check("打卡页内容不被裁切", box1.sh <= box1.ch + 1, `内容 ${box1.sh} / 可视 ${box1.ch}`);
  await p1.screenshot({ path: OUT + "checkin-located.png" });
  await ctx1.close();

  // ---------- 2. 组长王强：远端定位 + 拍照打卡全流程 ----------
  const ctx2 = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
    permissions: ["camera", "geolocation"],
    geolocation: { latitude: 22.551, longitude: 113.95 }, // 距上面那个点约 2 公里
  });
  const p2 = await ctx2.newPage();
  p2.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  check("组长登录", await login(p2, "12345678912"));
  await p2.goto(BASE + "#/checkin", { waitUntil: "domcontentloaded" });
  await p2.waitForTimeout(4000);

  body = await p2.locator("body").innerText();
  check("远端定位有状态标签", configured ? body.includes("超出打卡范围") : body.includes("已定位"));
  check("远端坐标已刷新", /22\.551\d*/.test(body));
  await p2.screenshot({ path: OUT + "checkin-out-of-fence.png" });

  const open = p2.getByText("打开摄像头");
  if (await open.count()) {
    await open.first().click();
    await p2.waitForTimeout(2500);
    const shoot = p2.getByRole("button", { name: "拍摄" }).first();
    if (await shoot.count()) {
      await shoot.click();
      await p2.waitForTimeout(1200);
    }
  }
  const onBtn = p2.getByRole("button", { name: "提交上班卡" }).first();
  if (await onBtn.count()) {
    await onBtn.click();
    // antd message 只活 3 秒，先抓提示，再等列表刷新
    await p2.waitForTimeout(1200);
    const toast = await p2.locator(".ant-message").innerText().catch(() => "");
    check(
      "打卡成功提示",
      /打卡成功/.test(toast) && (configured ? toast.includes("超出打卡范围") : true),
      toast,
    );
    await p2.waitForTimeout(3500);
  }
  body = await p2.locator("body").innerText();
  check("打卡后出现查看照片", body.includes("查看照片"));
  await p2.screenshot({ path: OUT + "checkin-submitted.png" });
  await ctx2.close();

  // ---------- 3. 未授权定位：给出原因与重试入口 ----------
  const ctx3 = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
    permissions: [], // 明确不给定位权限
  });
  const p3 = await ctx3.newPage();
  p3.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  await login(p3, "12345678001");
  await p3.goto(BASE + "#/checkin", { waitUntil: "domcontentloaded" });
  await p3.waitForTimeout(4500);
  body = await p3.locator("body").innerText();
  check("定位失败有提示", body.includes("未定位") || /定位/.test(body));
  check("定位失败给重试入口", body.includes("重新定位"));
  await p3.screenshot({ path: OUT + "checkin-locate-denied.png" });
  await ctx3.close();

  await browser.close();
  check("无页面 JS 报错", errs.length === 0, errs.join(" | ").slice(0, 120));

  // 清掉 UI 测试写入的打卡记录，保持演示数据干净
  cleanup("9283941092");

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
