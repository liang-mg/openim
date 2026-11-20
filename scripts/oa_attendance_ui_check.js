'use strict';
// 出勤记录页 UI 回归：独立页 + 月历 + 汇总 + 明细 + 切月 + 不裁切
// 用法：node scripts/oa_attendance_ui_check.js
// 只读接口，不写数据，跑完无需清理
const {
  chromium,
} = require('./lib/playwright-env');

const CHROME = require('./lib/playwright-env').CHROME;
const BASE = "http://127.0.0.1:5173/";
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

async function login(page, phone) {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  const acct = page.locator('input[placeholder*="账号"]').first();
  if (await acct.count()) await acct.fill(phone);
  const pwd = page.locator('input[type="password"]').first();
  if (await pwd.count()) await pwd.fill("Xinbo@2026");
  await page.getByRole("button", { name: /登录/ }).first().click();
  await page.waitForTimeout(5500);
  return !(await page.locator('input[type="tel"]').count());
}

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const errs = [];

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 120)));
  check("登录成功", await login(page, "12345678001"));

  // ---------- 1. 工作台两个入口不再指向同一页 ----------
  await page.goto(BASE + "#/work", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator('div[class*="app-item"]').filter({ hasText: "出勤记录" }).first().click();
  await page.waitForTimeout(2500);
  check("工作台「出勤记录」进入独立页", page.url().includes("#/attendance"), page.url().split("#")[1]);

  // ---------- 2. 页面结构 ----------
  let body = await page.locator("body").innerText();
  check("页面标题为出勤记录", body.includes("出勤记录"));
  check("顶部有四项汇总", /出勤天数/.test(body) && /迟到次数/.test(body) && /早退次数/.test(body) && /缺卡天数/.test(body));
  check("有颜色图例", body.includes("两次卡齐全") && body.includes("缺卡"));

  const cells = page.locator('div[class*="att-grid"] button');
  const cellCount = await cells.count();
  check("月历按月渲染", cellCount >= 28 && cellCount <= 31, `${cellCount} 格`);

  // ---------- 3. 内容不被裁切（关键回归：底部明细必须完整可见或可滚动到） ----------
  const box = await page
    .locator('div[class*="att-body"]')
    .first()
    .evaluate((el) => ({
      sh: el.scrollHeight,
      ch: el.clientHeight,
      canScroll: el.scrollHeight > el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
  check(
    "内容区可滚动到底（不再被外层裁掉）",
    box.overflowY === "auto" || box.sh <= box.ch + 1,
    `内容 ${box.sh} / 可视 ${box.ch}`,
  );

  await page
    .locator('div[class*="att-body"]')
    .first()
    .evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
  await page.waitForTimeout(400);
  const detailBox = await page.locator('div[class*="att-detail-card"]').first().boundingBox();
  check(
    "明细卡完整在可视区内",
    !!detailBox && detailBox.y + detailBox.height <= 900 + 2,
    detailBox ? `底部 ${Math.round(detailBox.y + detailBox.height)} / 视口 900` : "未找到",
  );

  // ---------- 4. 点日期看明细 ----------
  await cells.last().click();
  await page.waitForTimeout(600);
  const detail = await page.locator('div[class*="att-detail-card"]').first().innerText();
  check("点日期出当天明细", detail.includes("上班") && detail.includes("下班"), detail.replace(/\n/g, " ").slice(0, 46));

  // ---------- 5. 切月 ----------
  const monthBefore = await page.locator('span[class*="att-month"]').innerText();
  await page.locator('div[class*="att-month-nav"] button').first().click();
  await page.waitForTimeout(1800);
  const monthAfter = await page.locator('span[class*="att-month"]').innerText();
  check("月份可前后切换", monthBefore.trim() !== monthAfter.trim(), `${monthBefore.trim()} -> ${monthAfter.trim()}`);
  await page.getByText("回到本月").click();
  await page.waitForTimeout(1500);
  const monthBack = await page.locator('span[class*="att-month"]').innerText();
  check("回到本月生效", monthBack.trim() === monthBefore.trim(), monthBack.trim());
  await page.screenshot({ path: OUT + "attendance-page.png" });

  // ---------- 6. 与打卡页互相跳转 ----------
  await page.getByText(/去拍照打卡/).first().click();
  await page.waitForTimeout(2500);
  check("出勤页可跳去打卡", page.url().includes("#/checkin"), page.url().split("#")[1]);
  await page.getByText("查看本月出勤记录").first().click();
  await page.waitForTimeout(2500);
  check("打卡页可跳回出勤", page.url().includes("#/attendance"), page.url().split("#")[1]);

  await ctx.close();
  await browser.close();
  check("无页面 JS 报错", errs.length === 0, errs.join(" | ").slice(0, 120));

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
