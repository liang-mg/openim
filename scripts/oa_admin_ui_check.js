'use strict';
// 员工管理页交互验证：添加 -> 编辑改角色 -> 停用
const {
  chromium,
} = require('./lib/playwright-env');

const CHROME = require('./lib/playwright-env').CHROME;
const OUT = require('./lib/playwright-env').OUT;
const BASE = 'http://127.0.0.1:5173/';
const PHONE = '19306860353';

const log = (...a) => console.log(...a);
const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, deviceScaleFactor: 1.5 });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));

  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(1800);
  const acct = page.locator('input[placeholder*="账号"]').first();
  if (await acct.count()) await acct.fill(PHONE);
  const pwd = page.locator('input[type="password"]').first();
  if (await pwd.count()) await pwd.fill("Xinbo@2026");
  await page.getByRole("button", { name: /登录/ }).first().click();
  await page.waitForTimeout(5500);
  log('登录:', page.url().includes('/chat') ? 'OK' : 'FAIL');

  await page.goto(BASE + '#/oa-admin', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3200);

  const rows = () => page.locator('[class*="table-row"]');
  const before = await rows().count();
  log('添加前行数:', before);

  await page.getByRole('button', { name: /添加员工/ }).first().click();
  await page.waitForTimeout(1500);

  // 1) IM 账号：优先选「隧道测试」避免乱码昵称
  await page.locator('.ant-modal .ant-select:has(#user_id)').click();
  await page.waitForTimeout(900);
  let opts = page.locator('.ant-select-dropdown:visible .ant-select-item-option:not(.ant-select-item-option-disabled)');
  const labels = await opts.allInnerTexts();
  log('候选账号:', labels.map(clean).join(' | '));
  let idx = labels.findIndex((t) => t.includes('隧道测试'));
  if (idx < 0) idx = 0;
  await opts.nth(idx).click();
  await page.waitForTimeout(600);
  log('已选账号:', clean(labels[idx]));

  // 2) 姓名强制覆盖
  const nameInput = page.locator('.ant-modal input[id$="real_name"]');
  await nameInput.fill('测试成员');
  const deptInput = page.locator('.ant-modal input[id$="department"]');
  await deptInput.fill('市场部');
  const posInput = page.locator('.ant-modal input[id$="position"]');
  await posInput.fill('市场专员');

  // 3) 上级：第三个 select（0=IM账号, 1=角色, 2=上级）
  await page.locator('.ant-modal .ant-select:has(#manager_id)').click();
  await page.waitForTimeout(800);
  opts = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
  const mgrTexts = await opts.allInnerTexts();
  const mgrIdx = mgrTexts.findIndex((t) => t.includes('王强'));
  await opts.nth(mgrIdx >= 0 ? mgrIdx : 0).click();
  await page.waitForTimeout(400);
  log('已选上级:', clean(mgrTexts[mgrIdx >= 0 ? mgrIdx : 0]));

  await page.screenshot({ path: OUT + 'admin-modal-filled.png' });
  await page.getByRole('button', { name: /^保存$/ }).click();
  await page.waitForTimeout(2600);

  const after = await rows().count();
  log('添加后行数:', after, after === before + 1 ? 'PASS' : 'FAIL');
  const added = rows().filter({ hasText: '测试成员' }).first();
  log('新增行内容:', clean(await added.innerText()).slice(0, 70));
  await page.screenshot({ path: OUT + 'admin-after-add.png' });

  // 4) 编辑：改为组长（用字段 id 定位，避免 select 索引在编辑态变化）
  await added.getByText('编辑').click();
  await page.waitForTimeout(1500);
  await page.locator('.ant-modal .ant-select:has(#role)').click();
  await page.waitForTimeout(800);
  opts = page.locator('.ant-select-dropdown:visible .ant-select-item-option');
  const roleTexts = await opts.allInnerTexts();
  const roleIdx = roleTexts.findIndex((t) => clean(t).startsWith('组长'));
  log('角色候选:', roleTexts.map(clean).join(' | '), '=> 选中第', roleIdx);
  await opts.nth(roleIdx >= 0 ? roleIdx : 1).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: /^保存$/ }).click();
  await page.waitForTimeout(2500);
  const edited = clean(await rows().filter({ hasText: '测试成员' }).first().innerText());
  log('改角色后:', edited.slice(0, 80), edited.includes('组长') ? 'PASS' : 'FAIL');
  await page.screenshot({ path: OUT + 'admin-after-edit.png' });

  // 5) 停用
  await rows().filter({ hasText: '测试成员' }).first().getByText('停用').click();
  await page.waitForTimeout(900);
  await page.locator('.ant-modal-confirm .ant-btn-primary').click();
  await page.waitForTimeout(2400);
  const stillThere = await rows().filter({ hasText: '测试成员' }).count();
  log('停用后从列表消失:', stillThere === 0 ? 'PASS' : 'FAIL');
  await page.screenshot({ path: OUT + 'admin-after-disable.png' });

  // 6) 勾选"含已停用"应能看到
  await page.locator('[class*="disabled-toggle"] .ant-switch').click();
  await page.waitForTimeout(2200);
  const shownDisabled = await rows().filter({ hasText: '测试成员' }).count();
  const text = shownDisabled ? clean(await rows().filter({ hasText: '测试成员' }).first().innerText()) : '';
  log('含已停用可见:', shownDisabled === 1 ? 'PASS' : 'FAIL', text.slice(0, 70));
  await page.screenshot({ path: OUT + 'admin-include-disabled.png' });

  log('页面错误:', errs.length ? errs.join(' ; ') : 'none');
  await browser.close();
})().catch((e) => { console.error('EXCEPTION', e); process.exit(1); });
