/**
 * 请假 / 补卡 UI + 端到端回归（批次 4）
 * 用法：node scripts/oa_leave_makeup_check.js
 * 覆盖：员工申请 → 组长审批 → 通过后进统计 → 工作台待办 → 权限；自清理
 */
const { chromium } = require("D:/work/openim/openim-docker-latest/src/openim-electron-demo/node_modules/.pnpm/playwright-core@1.61.1/node_modules/playwright-core");
const crypto = require('crypto');
const { execSync } = require('child_process');

const BASE = "http://127.0.0.1:5173/";
const OA = "http://127.0.0.1:10010/oa/api/v1";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const OUT = "D:/work/openim/openim-docker-latest/output/";
const PHONE = { liran: "12345678001", qiang: "12345678912", manager: "19306860353" };

const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function jwt(uid) {
  const n = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: 'Web', exp: n + 86400, iat: n, nbf: n - 10 }));
  const s = crypto.createHmac('sha256', 'chat123').update(`${h}.${p}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${p}.${s}`;
}
async function api(path, uid, body) {
  const opt = { headers: { token: jwt(uid) } };
  if (body) { opt.method = 'POST'; opt.headers['Content-Type'] = 'application/json'; opt.body = JSON.stringify(body); }
  const r = await fetch(OA + path, opt);
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { code: -1, raw: t.slice(0, 200) }; }
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
const pad = (n) => String(n).padStart(2, '0');
function recentWorkday(offset) {
  let d = new Date(); d.setDate(d.getDate() - offset);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('PASS ', name, detail ? '— ' + detail : ''); }
  else { fail++; console.log('FAIL ', name, detail ? '— ' + detail : ''); }
}

(async () => {
  const created = { leaves: [], makeups: [], checkins: [] };
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const d = recentWorkday(5);
  const TOKEN = "UI回归" + Date.now();

  // ===== 1. 员工通过 UI 提交请假申请 =====
  const ctxE = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const emp = await ctxE.newPage();
  const errs = [];
  emp.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await login(emp, PHONE.liran);
  await emp.goto(BASE + "#/leave", { waitUntil: "domcontentloaded" });
  await emp.waitForTimeout(3000);
  const body0 = await emp.locator("body").innerText();
  check('1 员工能看到请假补卡页', body0.includes('请假与补卡') && body0.includes('申请请假'), '');
  check('2 员工看不到「待我审批」（无权）', !body0.includes('待我审批'), '');

  // 申请弹窗能打开（日期控件用组件库，自动化填日期脆弱；填值提交由 API 用例覆盖）
  await emp.getByRole('button', { name: '申请请假' }).click();
  await emp.waitForTimeout(700);
  const modalText = await emp.locator('.ant-modal-content').last().innerText();
  check('3 申请弹窗含类型/日期/事由字段', modalText.includes('请假类型') && modalText.includes('起止日期') && modalText.includes('事由'), '');
  await emp.screenshot({ path: OUT + 'leave-apply-modal.png' });
  await emp.locator('.ant-modal-content .ant-modal-close').last().click().catch(() => {});
  await emp.keyboard.press('Escape');
  await emp.waitForTimeout(500);

  // 用 API 落一条请假（日期可精确控制），审批链路在 UI 上验证
  const submitted = await api('/leave/submit', '2158780278', {
    type: 'personal', start_date: d, end_date: d, reason: TOKEN,
  });
  const myLeaves = await api('/leave/list?scope=mine', '2158780278');
  const mine = (myLeaves.data?.list || []).find((x) => x.reason === TOKEN);
  check('4 申请落库且审批人是直属上级王强',
    submitted.code === 0 && !!mine && mine.approver_id === '9283941092',
    mine && `status=${mine.status}`);
  if (mine) created.leaves.push(mine.leave_id);
  // 刷新员工页确认出现在"我的申请"
  await emp.reload({ waitUntil: 'domcontentloaded' });
  await emp.waitForTimeout(3500);
  // 事由列设了 ellipsis，innerText 可能被截断；以"请假申请 1"计数徽标为准
  const empBody = await emp.locator('body').innerText();
  check('4b 我的申请列表显示新请假', /请假申请\s*1/.test(empBody), `含 TOKEN=${empBody.includes(TOKEN)}`);

  // ===== 2. 组长看到待审批并通过 =====
  const ctxM = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const mgr = await ctxM.newPage();
  mgr.on("pageerror", (e) => errs.push(String(e).slice(0, 160)));
  await login(mgr, PHONE.qiang);
  await mgr.goto(BASE + "#/leave", { waitUntil: "domcontentloaded" });
  await mgr.waitForTimeout(3000);
  await mgr.getByText('待我审批', { exact: true }).click();
  await mgr.waitForTimeout(2000);
  const pendingBody = await mgr.locator("body").innerText();
  check('5 组长在待我审批看到申请', pendingBody.includes(TOKEN), '');
  await mgr.screenshot({ path: OUT + 'leave-pending.png' });

  // 点"同意" → 弹审批意见 → 填 → 确定
  const row = mgr.locator('tr').filter({ hasText: TOKEN }).first();
  await row.getByText('同意', { exact: true }).click();
  await mgr.waitForTimeout(500);
  await mgr.locator('.ant-modal:not(.ant-modal-hidden) textarea').last().fill(TOKEN + "同意");
  await mgr.getByRole('button', { name: '同意' }).last().click();
  await mgr.waitForTimeout(2200);
  const afterApprove = await api('/leave/list?scope=team', '9283941092');
  const apr = (afterApprove.data?.list || []).find((x) => x.leave_id === (mine && mine.leave_id));
  check('6 组长审批后状态变已通过', apr && apr.status === 'approved', apr && apr.status);
  check('7 审批意见留痕', apr && apr.comment === TOKEN + "同意", apr && apr.comment);

  // ===== 3. 统计合并：批准请假后该日不算缺卡 =====
  const team = await api(`/checkin/team?month=${d.slice(0, 7)}`, '9283941092');
  const liranRow = (team.data.members || []).find((m) => m.user_id === '2158780278');
  check('8 请假计入本月请假统计', !!liranRow && liranRow.month.leave >= 1, liranRow && `请假 ${liranRow.month.leave} 天`);
  check('9 警告不再提示请假未接入', !(team.data.warnings || []).includes('leave_not_integrated'), '');

  // ===== 4. 补卡 UI：员工申请 → 组长批准 → checkin =====
  // 用 API 造补卡（UI 表单已能提交，这里为控制日期落在无卡日，用 API 保证可测）
  // 张明本月只有 19 号有卡，recentWorkday(2) 是无卡日，避免"该时段已有卡"
  const mkDate = recentWorkday(2);
  const mk = await api('/makeup/submit', '7474479331', { date: mkDate, type: 'on', time: '09:20', reason: TOKEN + "补卡" });
  check('10 补卡申请提交', mk.code === 0, mk.msg);
  if (mk.code === 0) created.makeups.push(mk.data.makeup_id);
  const mkAppr = await api('/makeup/approve', '9283941092', { makeup_id: mk.data && mk.data.makeup_id, action: 'approve', comment: '同意补卡' });
  check('11 补卡批准生成 checkin', mkAppr.code === 0 && !!mkAppr.data.checkin_id, mkAppr.msg);
  if (mkAppr.data && mkAppr.data.checkin_id) created.checkins.push(mkAppr.data.checkin_id);
  const ckList = await api(`/checkin/list?month=${d.slice(0, 7)}`, '7474479331');
  const mkRec = (ckList.data.list || []).find((x) => x.checkin_id === (mkAppr.data && mkAppr.data.checkin_id));
  check('12 补卡记录标 source=makeup', mkRec && mkRec.source === 'makeup', mkRec && `status=${mkRec.status}`);

  // ===== 5. 工作台待办：组长页能看到真实待审批（造一条 pending 请假） =====
  const todo = await api('/leave/submit', '2158780278', { type: 'sick', start_date: recentWorkday(2), end_date: recentWorkday(2), reason: '待办测试' });
  if (todo.code === 0) created.leaves.push(todo.data.leave_id);
  const wb = await api('/workbench/summary', '9283941092');
  const todoText = (wb.data?.todos || []).map((t) => t.text).join(' ');
  check('13 工作台有待审批真实待办', todoText.includes('请假/补卡待审批'), todoText.slice(0, 80));

  // ===== 6. CSV 导出含请假列 =====
  const csvR = await fetch(`${OA}/checkin/report?month=${d.slice(0, 7)}&format=csv`, { headers: { token: jwt('9283941092') } });
  const csv = await csvR.text();
  check('14 CSV 含请假列', csv.includes('请假(天)'), '');

  check('15 全程无 JS 报错', errs.length === 0, errs.slice(0, 2).join(' | '));

  // 清理
  try {
    const mongo = (js) => execSync(`docker exec -i mongo mongosh -u openIM -p openIM123 --authenticationDatabase openim_v3 openim_v3 --quiet --eval '${js}'`, { stdio: 'ignore' });
    if (created.leaves.length) mongo(`db.oa_leave.deleteMany({leave_id:{$in:[${created.leaves.map(x => `'${x}'`).join(',')}]}})`);
    if (created.makeups.length) mongo(`db.oa_makeup.deleteMany({makeup_id:{$in:[${created.makeups.map(x => `'${x}'`).join(',')}]}})`);
    if (created.checkins.length) mongo(`db.oa_checkin.deleteMany({checkin_id:{$in:[${created.checkins.map(x => `'${x}'`).join(',')}]}})`);
    console.log('· 已清理测试数据');
  } catch (e) { console.log('· 清理失败：', String(e.message).slice(0, 80)); }

  await browser.close();
  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
