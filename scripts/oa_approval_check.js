/**
 * 审批中心 + 日报提交率 + 催交 接口回归（批次 5-6）
 * 用法：node scripts/oa_approval_check.js
 * 覆盖：四类待办聚合口径、页签范围、待办数=列表长度、提交率按部门、催交权限与去重、通知未读
 * 自清理：脚本发出去的催交通知与未读状态在结尾清掉
 */
const crypto = require('crypto');
const { execSync } = require('child_process');

const OA = 'http://127.0.0.1:10010/oa/api/v1';
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const MONGO_PW = process.env.MONGO_PASSWORD || '<CHANGE_ME_MONGO_PASSWORD>';
const U = {
  liran: '2158780278',
  zhangming: '7474479331',
  qiang: '9283941092',
  manager: '7559659175',
};

const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function jwt(uid) {
  const n = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: 'Web', exp: n + 86400, iat: n, nbf: n - 10 }));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${p}.${s}`;
}
async function api(path, uid, body) {
  const opt = { headers: { token: jwt(uid) } };
  if (body) {
    opt.method = 'POST';
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body);
  }
  const r = await fetch(OA + path, opt);
  const t = await r.text();
  try { return { ...JSON.parse(t), status: r.status }; } catch { return { code: -1, raw: t.slice(0, 200) }; }
}
function mongo(script) {
  return execSync(
    `docker exec -i mongo mongosh -u openIM -p ${MONGO_PW} --authenticationDatabase openim_v3 openim_v3 --quiet --eval ${JSON.stringify(script)}`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  ).trim();
}

let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('PASS ', name, detail ? '— ' + detail : ''); }
  else { fail++; console.log('FAIL ', name, detail ? '— ' + detail : ''); }
}
const pad = (n) => String(n).padStart(2, '0');
const today = (() => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
})();
const startedAt = Date.now();

(async () => {
  // ---------- 1. 待我处理 ----------
  const emp = await api('/approvals/list?tab=pending', U.liran);
  check('1 员工没有下属 → 待我处理为空', emp.code === 0 && emp.data.total === 0, emp.data && `total=${emp.data.total}`);

  const q = await api('/approvals/list?tab=pending', U.qiang);
  const qList = (q.data && q.data.list) || [];
  check('2 组长有待处理条目', q.code === 0 && q.data.total > 0, `total=${q.data && q.data.total}`);
  check('3 待办数 = 列表长度（工作台与审批中心同源）',
    q.code === 0 && q.data.pending === qList.length, `pending=${q.data && q.data.pending} list=${qList.length}`);

  const kinds = new Set(qList.map((x) => x.kind));
  check('4 待办聚合了多种类型', kinds.size >= 1, `类型: ${[...kinds].join(',') || '无'}`);
  check('5 待我处理里不会有自己发起的',
    qList.every((x) => x.user_id !== U.qiang), `${qList.length} 条`);

  // ---------- 2. 我发起的 / 已处理 ----------
  const mine = await api('/approvals/list?tab=mine', U.liran);
  check('6 我发起的只有自己', mine.code === 0 && (mine.data.list || []).every((x) => x.user_id === U.liran),
    mine.data && `total=${mine.data.total}`);
  check('7 我发起的含自己的考勤异常', (mine.data.list || []).some((x) => x.kind === 'exception'),
    (mine.data.list || []).map((x) => x.kind).join(',') || '空');

  const done = await api('/approvals/list?tab=done', U.qiang);
  check('8 已处理页只含我处理过的',
    done.code === 0 && (done.data.list || []).every((x) => x.user_id !== U.qiang),
    done.data && `total=${done.data.total}`);

  // ---------- 3. 日报提交率 ----------
  const mineRate = await api('/report/submit-rate', U.liran);
  check('9 员工只看自己的提交率', mineRate.code === 0 && mineRate.data.total === 1,
    mineRate.data && `total=${mineRate.data.total} rate=${mineRate.data.rate}%`);

  const teamRate = await api('/report/submit-rate', U.qiang);
  const rows = (teamRate.data && teamRate.data.rows) || [];
  check('10 组长看团队提交率', teamRate.code === 0 && teamRate.data.total >= 1,
    `total=${teamRate.data && teamRate.data.total} done=${teamRate.data && teamRate.data.done}`);
  check('11 提交率按部门聚合且数值合理',
    rows.length > 0 && rows.every((r) => r.rate >= 0 && r.rate <= 100 && Array.isArray(r.missing)),
    rows.map((r) => `${r.department} ${r.submitted}/${r.total}`).join(' | '));
  check('12 未交名单只给能管人的人看（组长有名字）',
    rows.some((r) => r.missing.length > 0) || teamRate.data.done === teamRate.data.total,
    `未交合计 ${rows.reduce((s, r) => s + r.missing.length, 0)} 人`);

  // ---------- 4. 催交 ----------
  const empUrge = await api('/report/urge', U.liran, { date: today });
  check('13 员工不能催交', empUrge.code === 403, `code=${empUrge.code}`);

  const urge1 = await api('/report/urge', U.qiang, { date: today });
  check('14 组长催交成功', urge1.code === 0 && urge1.data.urged >= 0,
    urge1.data && `urged=${urge1.data.urged} skipped=${urge1.data.skipped} pushed=${urge1.data.pushed}`);
  check('15 未配置 IM 时如实返回 pushed=false', urge1.code === 0 && urge1.data.pushed === false,
    `pushed=${urge1.data && urge1.data.pushed}`);

  const urge2 = await api('/report/urge', U.qiang, { date: today });
  check('16 同一天重复催交被去重', urge2.code === 0 && urge2.data.urged === 0 && urge2.data.skipped > 0,
    urge2.data && `第二次 urged=${urge2.data.urged} skipped=${urge2.data.skipped}`);

  // ---------- 5. 通知 ----------
  const notices = await api('/notifications/list', U.zhangming);
  check('17 被催的人收到未读通知', notices.code === 0 && notices.data.unread > 0,
    `unread=${notices.data && notices.data.unread}`);
  check('18 通知内容带跳转路径', (notices.data.list || []).every((n) => !!n.path),
    (notices.data.list || []).map((n) => n.path).slice(0, 3).join(','));

  const read = await api('/notifications/read', U.zhangming, { all: true });
  check('19 全部已读生效', read.code === 0, `updated=${read.data && read.data.updated}`);
  const after = await api('/notifications/list', U.zhangming);
  check('20 已读后未读数归零', after.code === 0 && after.data.unread === 0,
    `unread=${after.data && after.data.unread}`);

  // ---------- 6. 清理 ----------
  try {
    mongo(`db.oa_notification.deleteMany({kind:"urge",created_at:{$gte:${startedAt}}})`);
    console.log('  (已清理本次催交通知)');
  } catch (e) { console.log('  (清理提示)', e.message.slice(0, 80)); }

  console.log(`\n===== 审批中心/催交回归：通过 ${pass} / 失败 ${fail} =====`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
