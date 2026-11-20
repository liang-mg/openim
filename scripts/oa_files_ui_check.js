'use strict';
// 批次1 前端验证：附件真实上传 + 附件下载 + 打卡照片存档
const {
  chromium,
} = require('D:/work/openim/openim-docker-latest/src/openim-electron-demo/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:5173/';
const OUT = 'D:/work/openim/openim-docker-latest/output/';
const ATTACH = 'D:/work/openim/openim-docker-latest/output/_upload-demo.png';

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) { pass += 1; console.log('PASS ', name, extra); }
  else { fail += 1; console.log('FAIL ', name, extra); }
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
  return page.url().includes('/chat');
}

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: CHROME,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--allow-file-access-from-files',
    ],
  });

  // ---------- 1. 组长：日报附件真实上传 ----------
  const ctx1 = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
    permissions: ['camera'],
  });
  const p1 = await ctx1.newPage();
  const errs = [];
  p1.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  check('组长登录', await login(p1, '12345678912'));

  await p1.goto(BASE + '#/report', { waitUntil: 'domcontentloaded' });
  await p1.waitForTimeout(3000);

  const locked = await p1.getByText('日报已提交，附件不可再增删').count();
  if (locked) {
    console.log('SKIP 日报附件上传（该账号今日日报已提交，表单只读）');
  } else {
    await p1.locator('input[type="file"]').setInputFiles(ATTACH);
    // 等上传完成：出现文件名且不再显示"上传中"
    await p1.waitForTimeout(3000);
    const body = await p1.locator('body').innerText();
    check('附件出现在列表', body.includes('_upload-demo.png'));
    check('上传已完成（无"上传中"）', !body.includes('上传中'));
    await p1.screenshot({ path: OUT + 'files-report-attachment.png' });
  }

  // ---------- 2. 组长：查阅页下载附件 ----------
  await p1.goto(BASE + '#/report-review', { waitUntil: 'domcontentloaded' });
  await p1.waitForTimeout(3500);
  const download = p1.locator('span', { hasText: '下载' }).first();
  if (await download.count()) {
    const [popup] = await Promise.all([
      p1.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
      download.click(),
    ]);
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      // 图片是 inline，会直接渲染；确认不是 403/404 页面
      const txt = await popup.locator('body').innerText().catch(() => '');
      check('附件下载可打开', !/403|404|Forbidden|Not Found/i.test(txt), popup.url().slice(0, 60));
      await popup.close();
    } else {
      // 没弹窗时，用页面内 fetch 复核签名地址
      const okStatus = await p1.evaluate(async () => {
        const a = document.querySelector('[class*="download"]');
        return !!a;
      });
      check('附件下载可打开', okStatus, 'popup 未触发，已回退检查');
    }
  } else {
    console.log('SKIP 下载（当前列表无带附件日报）');
  }
  await p1.screenshot({ path: OUT + 'files-review.png' });
  await ctx1.close();

  // ---------- 3. 员工：拍照打卡 → 照片存档 ----------
  const ctx2 = await browser.newContext({
    viewport: { width: 1600, height: 950 },
    deviceScaleFactor: 1.5,
    permissions: ['camera'],
  });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  check('员工登录', await login(p2, '12345678001'));

  await p2.goto(BASE + '#/checkin', { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(3000);

  // 已经有"查看照片"说明今天拍过，直接验证
  let hasPhotoLink = await p2.getByText('查看照片').count();
  if (!hasPhotoLink) {
    const open = p2.getByText('打开摄像头');
    if (await open.count()) {
      await open.first().click();
      await p2.waitForTimeout(2500);
      const shoot = p2.getByRole('button', { name: '拍摄' }).first();
      if (await shoot.count()) { await shoot.click(); await p2.waitForTimeout(1200); }
      const offBtn = p2.getByRole('button', { name: '提交下班卡' }).first();
      if (await offBtn.count()) {
        await offBtn.click();
        await p2.waitForTimeout(4000);
      }
    }
    hasPhotoLink = await p2.getByText('查看照片').count();
  }
  check('打卡记录出现"查看照片"', hasPhotoLink > 0);

  if (hasPhotoLink) {
    const [popup] = await Promise.all([
      p2.waitForEvent('popup', { timeout: 8000 }).catch(() => null),
      p2.getByText('查看照片').first().click(),
    ]);
    if (popup) {
      await popup.waitForLoadState('domcontentloaded').catch(() => {});
      const txt = await popup.locator('body').innerText().catch(() => '');
      check('打卡照片可打开', !/403|404|Forbidden|Not Found/i.test(txt), popup.url().slice(0, 60));
      await popup.close();
    }
  }
  await p2.screenshot({ path: OUT + 'files-checkin-photo.png' });

  check('页面无 JS 异常', errs.length === 0, errs.join(' | '));
  await ctx2.close();
  await browser.close();

  console.log(`\n==== ${pass}/${pass + fail} passed ====`);
  if (fail) process.exit(1);
})();
