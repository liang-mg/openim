'use strict';
// 团队出勤 + 出勤报表回归（接口权限 12 条 + UI 6 条）
// 用法：node scripts/oa_team_attendance_check.js
// 会临时停用/恢复张明的档案（用于验证"停用的人不出现在团队列表"），结束时一定恢复。
const crypto = require('crypto');
const {
  chromium,
} = require('playwright-core');

const OA = 'http://127.0.0.1:10010/oa/api/v1';
const BASE = 'http://127.0.0.1:5173/';
const CHROME = process.env.CHROME_PATH || ''; // 留空用 playwright 自带 chromium
const OUT = require('path').resolve(__dirname, '../output') + require('path').sep;
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';

const UID = {
  liran: '2158780278',
  zhangming: '7474479331',
  wangqiang: '9283941092',
  wangjingli: '7559659175',
};
const PHONE = { wangqiang: '12345678912', wangjingli: '19306860353' };

const b64 = (b) =>
  Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function jwt(uid) {
  const n = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: 'Web', exp: n + 86400, iat: n, nbf: n - 10 }));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${p}.${s}`;
}
async function api(path, token, body) {
  const r = await fetch(OA + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, raw: text.slice(0, 200) };
  }
}

let pass = 0;
let fail = 0;
const check = (name, ok, extra = '') => {
  if (ok) {
    pass += 1;
    console.log('PASS ', name, extra);
  } else {
    fail += 1;
    console.log('FAIL ', name, extra);
  }
};

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

async function login(page, phone) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2200);
  const tab = page.getByText('验证码登录');
  if (await tab.count()) {
    await tab.first().click();
    await page.waitForTimeout(400);
  }
  const ph = page.locator('input[type="tel"], input[placeholder*="手机号"]').first();
  if (await ph.count()) await ph.fill(phone);
  const code = page.locator('input[placeholder*="验证码"]').first();
  if (await code.count()) await code.fill('666666');
  await page.getByRole('button', { name: /登录/ }).first().click();
  await page.waitForTimeout(6000);
}

(async () => {
  const tLi = jwt(UID.liran);
  const tZhang = jwt(UID.zhangming);
  const tWang = jwt(UID.wangqiang);
  const tMgr = jwt(UID.wangjingli);

  // ---------- 一、权限与范围（接口层） ----------
  const e1 = await api(`/checkin/team?month=${month}&scope=team`, tLi);
  check('1 员工调团队考勤被拒（403，不是空列表）', e1.code === 403, `code=${e1.code} ${e1.msg || ''}`);

  const e2 = await api(`/checkin/team?month=${month}&scope=team`, tZhang);
  check('2 另一个员工同样 403', e2.code === 403, `code=${e2.code}`);

  const t3 = await api(`/checkin/team?month=${month}`, tWang);
  const names3 = ((t3.data && t3.data.members) || []).map((m) => m.name);
  check(
    '3 组长只看得到自己的下属',
    t3.code === 0 && names3.includes('李然') && names3.includes('张明')
      && !names3.includes('王经理') && !names3.includes('王强'),
    names3.join(','),
  );

  const t4 = await api(`/checkin/team?month=${month}`, tMgr);
  const names4 = ((t4.data && t4.data.members) || []).map((m) => m.name);
  check(
    '4 领导看整条汇报链（含组长的下属）',
    t4.code === 0 && ['王强', '李然', '张明'].every((n) => names4.includes(n)),
    names4.join(','),
  );

  const t5 = await api(`/checkin/team?month=${month}&scope=all`, tMgr);
  check('5 管理员可用全公司范围', t5.code === 0 && t5.data.members.length >= 4, `${t5.data && t5.data.members.length} 人`);

  const t5b = await api(`/checkin/team?month=${month}&scope=all`, tWang);
  check('5b 组长用全公司范围被拒', t5b.code === 403, `code=${t5b.code}`);

  const m6 = await api(`/checkin/team/${UID.wangjingli}?month=${month}`, tWang);
  check('6 组长查上级月历 403（可见范围只向下）', m6.code === 403, `code=${m6.code}`);

  const m7 = await api(`/checkin/team/${UID.liran}?month=${month}`, tWang);
  const own7 = await api(`/checkin/list?month=${month}`, tLi);
  check(
    '7 组长查组员月历，条数与本人完全一致',
    m7.code === 0 && m7.data.total === own7.data.total,
    `组长看到 ${m7.data && m7.data.total} / 本人 ${own7.data.total}`,
  );

  // ---------- 二、停用不出现在团队里（改完立刻恢复） ----------
  let restored = false;
  try {
    const dis = await api('/admin/employee/disable', tMgr, { user_id: UID.zhangming, disabled: true });
    const t8 = await api(`/checkin/team?month=${month}`, tWang);
    const names8 = ((t8.data && t8.data.members) || []).map((m) => m.name);
    check(
      '8 停用成员从团队列表消失（历史记录仍保留）',
      dis.code === 0 && !names8.includes('张明'),
      names8.join(','),
    );
  } finally {
    const back = await api('/admin/employee/disable', tMgr, { user_id: UID.zhangming, disabled: false });
    restored = back.code === 0;
  }
  check('8b 停用状态已恢复（脚本不污染组织数据）', restored);

  // ---------- 三、口径 ----------
  const t10 = await api(`/checkin/team?month=${month}`, tWang);
  const liran10 = ((t10.data && t10.data.members) || []).find((m) => m.name === '李然');
  check(
    '10 今天只打了上班卡 → 进行中，不算缺卡',
    !!liran10 && (liran10.today.state === 'in_progress' || liran10.today.state === 'done'),
    liran10 ? `state=${liran10.today.state}` : '无数据',
  );
  check(
    '10b 进行中不影响"缺卡"计数（当天不计入分母）',
    !!liran10 && liran10.month.workdays <= 23,
    liran10 ? `应出勤 ${liran10.month.workdays} 天` : '',
  );

  const future = await api('/checkin/team?month=2026-12', tWang);
  check(
    '11 未来月份不串月、不出虚高的缺卡',
    future.code === 0 && (future.data.members || []).every((m) => m.month.workdays === 0 && m.month.absent === 0),
    future.code === 0 ? `${future.data.members.length} 人` : future.msg,
  );

  // ---------- 四、报表 ----------
  const rep = await api(`/checkin/report?month=${month}`, tWang);
  const rows = (rep.data && rep.data.rows) || [];
  const sumAttend = rows.reduce((a, r) => a + r.attend, 0);
  const sumAbsent = rows.reduce((a, r) => a + r.absent, 0);
  check('12 报表一行一个人，与团队列表人数一致', rep.code === 0 && rows.length === t10.data.members.length, `${rows.length} 行`);
  check('12b 合计行等于各行之和', rep.data && rep.data.total.attend === sumAttend && rep.data.total.absent === sumAbsent,
    rep.data ? `合计出勤 ${rep.data.total.attend} = ${sumAttend}` : '');
  check('12c 报表标注了节假日日历口径', (rep.data.warnings || []).includes('holiday_calendar_not_integrated'));

  const csvRes = await fetch(`${OA}/checkin/report?month=${month}&format=csv`, { headers: { token: tWang } });
  // fetch().text() 会把 BOM 当编码标记吃掉，这里直接看前 3 个字节是不是 EF BB BF
  const csvBuf = Buffer.from(await csvRes.arrayBuffer());
  const hasBom = csvBuf[0] === 0xef && csvBuf[1] === 0xbb && csvBuf[2] === 0xbf;
  const csv = csvBuf.toString('utf8');
  check(
    '12d 导出 CSV 带 BOM、表头正确、Excel 可直接打开',
    csvRes.status === 200 && hasBom && csv.includes('姓名') && csv.includes('出勤率') && csv.includes('合计'),
    `BOM=${hasBom} ${csv.split('\n').length} 行`,
  );

  // ---------- 五、UI ----------
  const browser = await chromium.launch({ headless: true, ...(CHROME ? { executablePath: CHROME } : {}) });
  const errs = [];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 140)));

  await login(page, PHONE.wangqiang);
  await page.goto(BASE + '#/attendance', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  let body = await page.locator('body').innerText();
  check('13 组长进页面默认「团队出勤」，不是自己的月历', body.includes('团队出勤') && body.includes('应到'), '');
  check('14 汇总显示今天应到/已到/未到', /应到\s*\d+\s*人/.test(body) && body.includes('未打卡'));
  check('15 页面写明作息（09:05 上班 / 18:00 下班）', body.includes('09:05') && body.includes('18:00'));
  check('16 缺卡口径有提示（节假日日历）', body.includes('节假日日历尚未接入'));

  // antd 的 tbody 第一行是 measurement row（空的），要过滤掉才能拿真实数据行
  const rowsOf = async () =>
    (await page.locator('table tbody tr').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  const rowTexts = await rowsOf();
  const hasExceptionFirst = rowTexts.length >= 1 && /迟到|早退|未打卡|缺卡/.test(rowTexts[0] || '');
  check('17 异常的人排在前面', hasExceptionFirst, (rowTexts[0] || '').replace(/\s+/g, ' ').slice(0, 40));

  await page.screenshot({ path: OUT + 'att-team.png' });

  // 只看异常
  await page.locator('button[role="switch"]').first().click();
  await page.waitForTimeout(1800);
  const onlyExc = await rowsOf();
  check('18 「只看异常」过滤掉正常的人', onlyExc.length <= rowTexts.length && onlyExc.length >= 1,
    `${rowTexts.length} → ${onlyExc.length} 行`);
  await page.locator('button[role="switch"]').first().click();
  await page.waitForTimeout(1200);

  // 成员月历
  const link = page.getByText('查看月历', { exact: false }).first();
  await link.click();
  await page.waitForTimeout(2200);
  body = await page.locator('body').innerText();
  check('19 点成员弹出只读月历（不提供改卡入口）',
    body.includes('出勤月历') && body.includes('只读') && !body.includes('补卡'),
    '');
  await page.screenshot({ path: OUT + 'att-team-drawer.png' });
  // 关抽屉：点右上关闭按钮，并等遮罩真正消失。
  // 只按 Escape 时关闭动画未必结束，紧接着点页签会被 mask 吃掉，表现为 30s 超时。
  await page.locator('.ant-drawer-close').first().click().catch(() => {});
  await page.locator('.ant-drawer-mask').first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);

  // 报表：等「导出报表」按钮真的出现再断言，避免 Segmented 点击动画未完成时误判
  const reportTab = page.locator('.ant-segmented-item', { hasText: '出勤报表' }).first();
  await reportTab.scrollIntoViewIfNeeded().catch(() => {});
  await reportTab.click();
  await page.getByRole('button', { name: /导出报表/ }).waitFor({ timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1200);
  body = await page.locator('body').innerText();
  check('20 报表页有合计行与导出按钮',
    body.includes('合计') && body.includes('导出报表') && body.includes('出勤率'),
    body.includes('合计') ? '' : '未见合计行');
  await page.screenshot({ path: OUT + 'att-report.png' });

  check('21 全程无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
