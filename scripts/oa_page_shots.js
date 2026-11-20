'use strict';
// 桌面端 OA 四页联调截图：验证码登录后依次访问工作台/打卡/日报/查阅
const {
  chromium,
} = require('playwright-core');

const CHROME = process.env.CHROME_PATH || ''; // 留空用 playwright 自带 chromium
const OUT = require('path').resolve(__dirname, '../output') + require('path').sep;
const BASE = 'http://127.0.0.1:5173/';
const PHONE = process.argv[2] || '12345678001';

const PAGES = [
  ['work', '#/work'],
  ['checkin', '#/checkin'],
  ['report', '#/report'],
  ['review', '#/report-review'],
  ['admin', '#/oa-admin'],
];

(async () => {
  const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}) });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 160)));

  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const codeTab = page.getByText('验证码登录');
  if (await codeTab.count()) { await codeTab.first().click(); await page.waitForTimeout(400); }
  const phone = page.locator('input[type="tel"], input[placeholder*="手机号"]').first();
  if (await phone.count()) await phone.fill(PHONE);
  const code = page.locator('input[placeholder*="验证码"]').first();
  if (await code.count()) await code.fill('666666');
  const loginBtn = page.getByRole('button', { name: '登录' });
  if (await loginBtn.count()) await loginBtn.first().click();
  await page.waitForTimeout(6000);
  console.log('LOGIN ->', page.url().replace(BASE, ''), '| phone:', PHONE);
  if (!page.url().includes('/chat')) { console.log('LOGIN FAILED'); await browser.close(); process.exit(1); }

  for (const [name, hash] of PAGES) {
    const before = errs.length;
    await page.goto(BASE + hash, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3800);
    await page.screenshot({ path: `${OUT}oa-${name}.png` });
    const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 110);
    console.log(`${name.padEnd(8)} url=${page.url().replace(BASE, '')} err=${errs.length - before}`);
    console.log(`         ${text}`);
    if (errs.length > before) console.log('         ' + errs.slice(before).join(' ; '));
  }

  await browser.close();
})().catch((e) => { console.error('EXCEPTION', e); process.exit(1); });
