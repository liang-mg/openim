'use strict';
// OA 端到端校验：员工提交 -> 权限隔离 -> 组长点评上报 -> 领导归档
const crypto = require('crypto');

const OA = 'http://127.0.0.1:10010/oa/api/v1';
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function signJWT(userID) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    UserID: userID, Platform: 'Web', exp: now + 86400, iat: now, nbf: now - 10,
  }));
  const sig = crypto.createHmac('sha256', SECRET).update(`${header}.${payload}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${header}.${payload}.${sig}`;
}

async function api(path, token, body) {
  const res = await fetch(OA + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = { raw: text }; }
  return { status: res.status, ...json };
}

const EMP_A = '2158780278';  // 李然 employee
const EMP_B = '7474479331';  // 张明 employee
const MGR = '9283941092';    // 王强 manager
const LEADER = '7559659175'; // 王经理 leader

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

(async () => {
  const tA = signJWT(EMP_A), tB = signJWT(EMP_B), tM = signJWT(MGR), tL = signJWT(LEADER);

  const h = await api('/healthz', tA);
  record('healthz', h.code === 0, h.data && h.data.status);

  // 1. 身份
  const meA = await api('/me', tA);
  record('/me 员工身份', meA.code === 0 && meA.data.user_id === EMP_A && meA.data.role === 'employee',
    `${meA.data.real_name}/${meA.data.role}`);
  const meM = await api('/me', tM);
  record('/me 组长角色', meM.code === 0 && meM.data.role === 'manager', meM.data.role);
  const meL = await api('/me', tL);
  record('/me 领导角色', meL.code === 0 && meL.data.role === 'leader', meL.data.role);

  // 2. 员工 A 提交日报
  // 用一个尚未归档的日期做全流程（默认从昨天往前找），避免撞上已归档的演示数据
  const ovInit = await api('/report/overview', tA);
  const usedPeriods = new Set(((ovInit.data && ovInit.data.recent) || [])
    .filter((r) => r.status === 'archived')
    .map((r) => r.period));
  let period = '';
  let sub = { code: -1, msg: '' };
  for (let i = 1; i <= 30; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const p = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (usedPeriods.has(p)) continue;
    sub = await api('/report/submit', tA, {
      type: 'daily',
      period: p,
      content: { done: '完成 OA 工作台与打卡页联调', plan: '明天推进日报审阅链路', issues: '接口鉴权需继续核对' },
      attachments: [],
      status: 'submitted',
    });
    // 撞上已归档/已上报的日期会被拒绝，换下一天再试
    if (sub.code === 0) { period = p; break; }
  }
  const rid = sub.data && sub.data.report_id;
  record('员工提交日报', sub.code === 0 && sub.data.status === 'submitted',
    `period=${period} status=${sub.data && sub.data.status} id=${rid}`);

  // 3. 员工 A 概览只含本人
  const ovA = await api('/report/overview', tA);
  const recentA = (ovA.data && ovA.data.recent) || [];
  const allMine = recentA.every((r) => r.author && r.author.user_id === EMP_A);
  record('员工概览仅含本人日报', ovA.code === 0 && allMine && recentA.length >= 1,
    `count=${recentA.length} allMine=${allMine}`);

  // 4. 员工 B 看不到 A 的
  const ovB = await api('/report/overview', tB);
  const recentB = (ovB.data && ovB.data.recent) || [];
  const leaked = recentB.some((r) => r.author && r.author.user_id === EMP_A);
  record('员工 B 无法看到 A 的日报', ovB.code === 0 && !leaked, `count=${recentB.length} leaked=${leaked}`);

  // 5. 员工 B 越权点评
  const evil = await api('/report/review', tB, { report_id: rid, comment: '越权点评尝试', view: 'manager' });
  record('普通员工越权点评被拒', evil.code !== 0, `code=${evil.code} msg=${evil.msg || ''}`);

  // 6. 组长待审列表
  const rl = await api('/report/review-list?view=manager', tM);
  const pending = (rl.data && rl.data.list) || [];
  const hit = pending.some((r) => r.report_id === rid);
  record('组长待审列表含该日报', rl.code === 0 && hit, `total=${rl.data && rl.data.total} hit=${hit}`);

  // 7. 组长点评 + 上报
  const rv = await api('/report/review', tM, { report_id: rid, comment: '整体不错，注意接口鉴权细节。', view: 'manager' });
  record('组长提交点评', rv.code === 0, `msg=${rv.msg || 'ok'}`);
  const esc = await api('/report/escalate', tM, { report_id: rid });
  record('组长上报领导', esc.code === 0 && esc.data && esc.data.status === 'pending_leader',
    `status=${esc.data && esc.data.status}`);

  // 8. 组长不能归档
  const archMgr = await api('/report/archive', tM, { report_id: rid });
  record('组长归档被拒（仅领导）', archMgr.code !== 0, `code=${archMgr.code} msg=${archMgr.msg || ''}`);

  // 9. 领导可见
  const all = await api('/report/all-for-review', tL);
  const allList = Array.isArray(all.data) ? all.data : [];
  record('领导可查阅上报日报', all.code === 0 && allList.some((r) => r.report_id === rid), `count=${allList.length}`);

  // 10. 领导归档
  const arch = await api('/report/archive', tL, { report_id: rid });
  record('领导归档成功', arch.code === 0 && arch.data && arch.data.status === 'archived',
    `status=${arch.data && arch.data.status}`);

  // 11. 归档后不可撤回
  const wd = await api('/report/withdraw', tA, { report_id: rid });
  record('已归档日报不可撤回', wd.code !== 0, `code=${wd.code} msg=${wd.msg || ''}`);

  // 12. 组长视角不应看到归档/上报后的（review-list manager 只看 submitted）
  const rl2 = await api('/report/review-list?view=manager', tM);
  const stillPending = ((rl2.data && rl2.data.list) || []).some((r) => r.report_id === rid);
  record('上报后移出组长待审队列', !stillPending, `stillPending=${stillPending}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('EXCEPTION', e); process.exit(2); });
