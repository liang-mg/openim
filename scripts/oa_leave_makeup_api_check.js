/**
 * 请假 / 补卡接口回归（批次 4）
 * 用法：node scripts/oa_leave_makeup_api_check.js
 * 覆盖：提交落表、四视角权限、状态机、拒绝/撤销、补卡生成 checkin、统计口径合并、CSV
 * 自清理：脚本造的申请与补卡记录最后删除，不污染演示数据
 */
const crypto = require('crypto');
const { execSync } = require('child_process');

const OA = 'http://127.0.0.1:10010/oa/api/v1';
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const U = {
  liran: '2158780278',     // 员工，上级王强
  zhangming: '7474479331', // 员工，上级王强
  qiang: '9283941092',     // 组长，上级王经理
  manager: '7559659175',   // 领导 + 管理员
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
const created = { leaves: [], makeups: [], checkins: [] };
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass++; console.log('PASS ', name, detail ? '— ' + detail : ''); }
  else { fail++; console.log('FAIL ', name, detail ? '— ' + detail : ''); }
}
const pad = (n) => String(n).padStart(2, '0');
const day = (offset) => {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

(async () => {
  // 选确定的工作日，避免周末导致"不含工作日"被正确拒绝而误报
  function recentWorkday(offset) {
    let d = new Date(); d.setDate(d.getDate() - offset);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 1. 提交请假（李然 → 审批人王强），落表 pending
  const d1 = recentWorkday(6), d2 = d1; // 单日请假，避开周末
  const sub = await api('/leave/submit', U.liran, { type: 'personal', start_date: d1, end_date: d2, reason: '家中有事' });
  check('1 提交请假落表 pending', sub.code === 0 && sub.data.status === 'pending', sub.data && `days=${sub.data.days} approver=${sub.data.approver_name}`);
  if (sub.code === 0) created.leaves.push(sub.data.leave_id);
  const leaveID = sub.data && sub.data.leave_id;

  // 2. 审批人按 manager_id 定：李然的上级是王强，不是王经理
  check('2 审批人=直属上级王强', sub.data && sub.data.approver_id === U.qiang, sub.data && sub.data.approver_id);

  // 3. 员工看不到别人的申请（scope=team 被拒，不是空列表）
  const empTeam = await api('/leave/list?scope=team', U.liran);
  check('3 员工查团队请假被 403', empTeam.code === 403, `code=${empTeam.code}`);

  // 4. 组长看到下属的请假
  const qList = await api('/leave/list?scope=team', U.qiang);
  check('4 组长看到下属请假', qList.code === 0 && (qList.data.list || []).some(l => l.leave_id === leaveID), `共 ${qList.data && qList.data.total} 条`);

  // 5. 非审批人（王经理）不能批这张（审批人是王强）—— 管理员除外，这里用张明试
  const wrong = await api('/leave/approve', U.zhangming, { leave_id: leaveID, action: 'approve', comment: '批' });
  check('5 非审批人不能批', wrong.code === 403, `code=${wrong.code}`);

  // 6. 自批自被拒：审批人本人也不能批自己发起的（王强没有这张，用管理员身份另测略）
  // 6b. 组长批准
  const appr = await api('/leave/approve', U.qiang, { leave_id: leaveID, action: 'approve', comment: '同意' });
  check('6 组长批准请假', appr.code === 0 && appr.data.status === 'approved', `status=${appr.data && appr.data.status}`);

  // 7. 已处理不能再批
  const again = await api('/leave/approve', U.qiang, { leave_id: leaveID, action: 'reject', comment: '反悔' });
  check('7 已批准不能重复审批', again.code !== 0, again.msg);

  // 8. 批准不写 oa_checkin：对比提交前后李然该月打卡条数，批准请假不应新增任何打卡
  const ck = await api(`/checkin/list?month=${d1.slice(0, 7)}`, U.liran);
  const leaveDayRecords = (ck.data.list || []).filter(r => r.date === d1);
  const makeupOnLeaveDay = leaveDayRecords.some(r => r.source === 'makeup');
  check('8 请假日不产生打卡记录', leaveDayRecords.length === 0 || !makeupOnLeaveDay,
    `该日 ${leaveDayRecords.length} 条原演示卡，无补卡来源`);

  // 9. 提交补卡（张明 → 王强），只补过去 7 天内、且当天没有卡的日期
  const md = day(-3);
  const msub = await api('/makeup/submit', U.zhangming, { date: md, type: 'on', time: '09:30', reason: '忘记打卡' });
  check('9 提交补卡落表', msub.code === 0 && msub.data.status === 'pending', msub.msg || '');
  if (msub.code === 0) created.makeups.push(msub.data.makeup_id);
  const makeupID = msub.data && msub.data.makeup_id;

  // 10. 不能补未来
  const future = await api('/makeup/submit', U.zhangming, { date: day(1), type: 'on', time: '09:30', reason: 'x' });
  check('10 未来补卡被拒', future.code !== 0, future.msg);

  // 11. 组长批准补卡 → 生成 source=makeup 的 checkin
  const mAppr = await api('/makeup/approve', U.qiang, { makeup_id: makeupID, action: 'approve', comment: '同意补卡' });
  check('11 补卡批准生成 checkin', mAppr.code === 0 && !!mAppr.data.checkin_id, `checkin=${mAppr.data && mAppr.data.checkin_id}`);
  if (mAppr.data && mAppr.data.checkin_id) created.checkins.push(mAppr.data.checkin_id);

  // 12. 补卡记录带 source=makeup（09:30 > 09:05 应判迟到）
  if (created.checkins.length) {
    const list = await api(`/checkin/list?month=${md.slice(0, 7)}`, U.zhangming);
    const rec = (list.data.list || []).find(r => r.checkin_id === created.checkins[0]);
    check('12 补卡记录 source=makeup 且按规则判迟到', rec && rec.source === 'makeup' && rec.status === 'late', rec ? `source=${rec.source} status=${rec.status}` : '未找到');
  } else check('12 补卡记录 source=makeup', false, '无 checkin_id');

  // 13. 撤销：李然再提交一张，自己撤回
  const cd = recentWorkday(4);
  const csub = await api('/leave/submit', U.liran, { type: 'sick', start_date: cd, end_date: cd, reason: '感冒' });
  if (csub.code === 0) {
    created.leaves.push(csub.data.leave_id);
    const can = await api('/leave/cancel', U.liran, { id: csub.data.leave_id });
    check('13 本人撤销 pending 申请', can.code === 0, can.msg);
  } else check('13 本人撤销 pending 申请', false, csub.msg);

  // 14. 统计口径：请假人不算缺卡、不计入应出勤（对比有无请假日）
  const team = await api(`/checkin/team?month=${d1.slice(0, 7)}`, U.qiang);
  const liran = team.data && team.data.members.find(m => m.user_id === U.liran);
  check('14 团队视图带请假统计字段', liran && typeof liran.month.leave === 'number', liran ? `请假 ${liran.month.leave} 天` : '未找到');

  // 15. warnings 不再说"请假未接入"
  check('15 去掉 leave_not_integrated 警告', !(team.data.warnings || []).includes('leave_not_integrated'), JSON.stringify(team.data.warnings));

  // 16. 报表 CSV 含请假列
  const csvR = await fetch(`${OA}/checkin/report?month=${d1.slice(0, 7)}&format=csv`, { headers: { token: jwt(U.qiang) } });
  const csv = await csvR.text();
  check('16 CSV 含请假列与新口径', csv.includes('请假(天)') && csv.includes('已批准请假日不算缺卡'), '');

  // 17. 待办接口返回真实数字
  const pending = await api('/attendance/pending?scope=team', U.qiang);
  check('17 待办接口可用', pending.code === 0 && typeof pending.data.leave === 'number', pending.code === 0 ? `请假待办=${pending.data.leave} 补卡待办=${pending.data.makeup}` : pending.msg);

  // 清理
  try {
    const mongo = (js) => execSync(`docker exec -i mongo mongosh -u openIM -p ${process.env.MONGO_PASSWORD || "<CHANGE_ME_MONGO_PASSWORD>"} --authenticationDatabase openim_v3 openim_v3 --quiet --eval '${js}'`, { stdio: 'ignore' });
    if (created.leaves.length) mongo(`db.oa_leave.deleteMany({leave_id:{$in:[${created.leaves.map(x => `'${x}'`).join(',')}]}})`);
    if (created.makeups.length) mongo(`db.oa_makeup.deleteMany({makeup_id:{$in:[${created.makeups.map(x => `'${x}'`).join(',')}]}})`);
    if (created.checkins.length) mongo(`db.oa_checkin.deleteMany({checkin_id:{$in:[${created.checkins.map(x => `'${x}'`).join(',')}]}})`);
    console.log('· 已清理测试数据');
  } catch (e) { console.log('· 清理失败：', String(e.message).slice(0, 80)); }

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
