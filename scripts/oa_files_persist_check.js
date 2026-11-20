'use strict';
// 持久化验证：提交带附件的日报 → 刷新页面 → 附件仍在且缩略图能加载 → 领导能下载
const {
  chromium,
} = require('./lib/playwright-env');
const crypto = require('crypto');

const CHROME = require('./lib/playwright-env').CHROME;
const BASE = 'http://127.0.0.1:5173/';
const OUT = require('./lib/playwright-env').OUT;
const ATTACH = OUT + '_upload-demo.png';

let pass = 0, fail = 0;
const check = (n, ok, extra = '') => {
  if (ok) { pass++; console.log('PASS ', n, extra); } else { fail++; console.log('FAIL ', n, extra); }
};

function token(uid) {
  const b64 = (x) => Buffer.from(x).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: 'Web', exp: now + 86400, iat: now, nbf: now - 10 }));
  const s = crypto.createHmac('sha256', 'chat123').update(`${h}.${p}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  await login(page, '12345678912'); // 王强：当天没有日报，可写

  await page.goto(BASE + '#/report', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  const already = await page.getByText('日报已提交，附件不可再增删').count();
  if (already) {
    console.log('NOTE 今日日报已提交，跳过"上传并提交"，直接验证刷新后的回填');
  } else {
    await page.locator('input[type="file"]').setInputFiles(ATTACH);
    await page.waitForTimeout(3000);
    await page.locator('textarea').first().fill('验证附件持久化：提交后刷新仍可下载');
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: /提交报告/ }).first().click();
    await page.waitForTimeout(4000);
    const afterSubmit = await page.locator('body').innerText();
    check('提交成功', afterSubmit.includes('日报已提交，附件不可再增删') || afterSubmit.includes('已提交'), '');
  }

  // 刷新：走后端回填，附件必须还在
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  const body = await page.locator('body').innerText();
  check('刷新后附件仍存在', body.includes('_upload-demo.png'));

  // 缩略图真的加载出来了（签名地址可用）
  const imgOk = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.some((i) => i.src.includes('/oa/api/v1/files/') && i.naturalWidth > 0);
  });
  check('缩略图加载成功', imgOk);
  await page.screenshot({ path: OUT + 'files-report-persist.png' });

  // 领导端通过接口下载同一份附件
  const me = await page.evaluate(async () => {
    const r = await fetch('/oa/api/v1/report/overview', { headers: { token: '' } });
    return r.status;
  }).catch(() => 0);
  const ov = await fetch('http://127.0.0.1:10010/oa/api/v1/report/overview', {
    headers: { token: token('9283941092') },
  }).then((r) => r.json());
  const rec = (ov.data.recent || []).find((r) => r.attachments && r.attachments.length);
  check('后端已存附件记录', !!rec, rec ? `${rec.period} ${rec.attachments[0].url}` : '无');

  if (rec) {
    const link = await fetch(`http://127.0.0.1:10010/oa/api/v1/files/${rec.attachments[0].url.split('/').pop()}/link`, {
      headers: { token: token('7559659175') },
    }).then((r) => r.json());
    const status = await fetch('http://127.0.0.1:10010' + link.data.signed_url).then((r) => r.status);
    check('领导可下载该附件', status === 200, `status=${status}`);
  }

  await browser.close();
  console.log(`\n==== ${pass}/${pass + fail} passed ====`);
  if (fail) process.exit(1);
})();
