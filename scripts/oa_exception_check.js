/**
 * 考勤异常 + 考勤规则 接口回归（批次 5 / 3.1）
 * 用法：node scripts/oa_exception_check.js
 * 覆盖：扫描权限与幂等、四视角可见范围、处理状态机、本人申诉、规则读写与校验
 * 自清理：脚本处理过的异常恢复成 open，造的规则恢复成默认值
 */
const crypto = require('crypto');
const { execSync } = require('child_process');

const OA = 'http://127.0.0.1:10010/oa/api/v1';
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const MONGO_PW = process.env.MONGO_PASSWORD || '<CHANGE_ME_MONGO_PASSWORD>';
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
async function api(path, uid, body, method) {
  const opt = { headers: { token: jwt(uid) } };
  if (body || method === 'POST') {
    opt.method = 'POST';
    opt.headers['Content-Type'] = 'application/json';
    opt.body = JSON.stringify(body || {});
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
const month = new Date().toISOString().slice(0, 7);

(async () => {
  // ---------- 1. 扫描权限 ----------
  const empScan = await api('/checkin/exception/scan?days=3', U.liran, {});
  check('1 员工不能触发扫描', empScan.code === 403, `code=${empScan.code}`);

  // ---------- 2. 扫描幂等 ----------
  const s1 = await api('/checkin/exception/scan?days=3', U.qiang, {});
  check('2 组长可触发扫描', s1.code === 0, s1.data && `scanned=${s1.data.scanned} created=${s1.data.created}`);
  const s2 = await api('/checkin/exception/scan?days=3', U.qiang, {});
  check('3 重复扫描幂等（不重复生成）', s2.code === 0 && s2.data.created === 0,
    s2.data && `第二次 created=${s2.data.created} skipped=${s2.data.skipped}`);

  // ---------- 3. 列表可见范围 ----------
  const mine = await api(`/checkin/exception/list?scope=mine&month=${month}`, U.liran);
  const mineOK = mine.code === 0 && (mine.data.list || []).every((x) => x.user_id === U.liran);
  check('4 本人只看自己的异常', mineOK, mine.data && `total=${mine.data.total}`);

  const empTeam = await api(`/checkin/exception/list?scope=team&month=${month}`, U.liran);
  check('5 员工查团队异常被 403', empTeam.code === 403, `code=${empTeam.code}`);

  const qTeam = await api(`/checkin/exception/list?scope=team&month=${month}`, U.qiang);
  const qTeamOK = qTeam.code === 0 && (qTeam.data.list || []).every((x) => x.user_id !== U.qiang);
  check('6 组长看到下属异常（不含自己）', qTeamOK, qTeam.data && `total=${qTeam.data.total}`);

  const all = await api(`/checkin/exception/list?scope=all&month=${month}`, U.manager);
  const depts = new Set((all.data && all.data.list || []).map((x) => x.user_id));
  check('7 管理员看全公司', all.code === 0 && depts.size >= 2, `涉及 ${depts.size} 人`);

  // ---------- 4. 处理权限与状态机 ----------
  const target = ((qTeam.data && qTeam.data.list) || []).find((x) => x.status === 'open' || x.status === 'appealed');
  check('8 组长范围内存在待处理异常', !!target, target && `${target.user_name} ${target.date} ${target.kind_text}`);
  if (target) {
    // 员工不能处理别人的
    const empHandle = await api('/checkin/exception/handle', U.liran,
      { exception_id: target.exception_id, action: 'ignore', comment: '不关我事' });
    const empDenied = target.user_id === U.liran
      ? empHandle.code !== 0 // 自己的异常自己也不能处理
      : empHandle.code === 403;
    check('9 员工不能处理该异常', empDenied, `code=${empHandle.code}`);

    // 不填意见被拒
    const noComment = await api('/checkin/exception/handle', U.qiang,
      { exception_id: target.exception_id, action: 'ignore', comment: '  ' });
    check('10 处理必须填意见', noComment.code !== 0, noComment.msg);

    // 组长处理
    const done = await api('/checkin/exception/handle', U.qiang,
      { exception_id: target.exception_id, action: 'ignore', comment: 'UI回归：当天外出办公' });
    check('11 组长处理成功', done.code === 0 && done.data.status === 'ignored',
      done.data && `status=${done.data.status}`);

    // 已处理不能再处理
    const again = await api('/checkin/exception/handle', U.qiang,
      { exception_id: target.exception_id, action: 'resolve', comment: '反悔' });
    check('12 已处理不能重复处理', again.code !== 0, again.msg);

    // 恢复现场，避免污染演示数据
    try {
      mongo(`db.oa_checkin_exception.updateOne({exception_id:${JSON.stringify(target.exception_id)}},{$set:{status:"open"},$unset:{handler_id:"",handler_name:"",handled_at:"",comment:""}})`);
    } catch (e) { /* 清理失败不影响用例结论，但要能看见 */ console.log('  (清理提示)', e.message.slice(0, 80)); }
  }

  // ---------- 5. 本人申诉 ----------
  const own = ((mine.data && mine.data.list) || []).find((x) => x.status === 'open');
  if (own) {
    const appeal = await api('/checkin/exception/appeal', U.liran,
      { exception_id: own.exception_id, note: 'UI回归：当天服务器记录延迟' });
    check('13 本人可以申诉', appeal.code === 0 && appeal.data.status === 'appealed',
      appeal.data && `status=${appeal.data.status}`);
    const other = await api('/checkin/exception/appeal', U.zhangming,
      { exception_id: own.exception_id, note: '替人申诉' });
    check('14 不能申诉别人的异常', other.code !== 0, other.msg);
    try {
      mongo(`db.oa_checkin_exception.updateOne({exception_id:${JSON.stringify(own.exception_id)}},{$set:{status:"open"},$unset:{comment:""}})`);
    } catch (e) { /* ignore */ }
  } else {
    check('13 本人可以申诉', false, '当前没有可申诉的 open 异常（跳过将漏测申诉链路）');
    check('14 不能申诉别人的异常', false, '同上');
  }

  // ---------- 6. 考勤规则 ----------
  const rule0 = await api('/attendance/rule', U.liran);
  check('15 所有登录用户可读规则', rule0.code === 0 && !!rule0.data.work_on_time,
    rule0.data && `${rule0.data.work_on_time}-${rule0.data.work_off_time} source=${rule0.data.source}`);

  const empSave = await api('/attendance/rule', U.liran, { work_on_time: '10:00', work_off_time: '19:00' });
  check('16 员工不能改规则', empSave.code === 403, `code=${empSave.code}`);

  const badTime = await api('/attendance/rule', U.manager,
    { work_on_time: '9:05', work_off_time: '18:00', earliest_on: '06:30' });
  check('17 非法时间格式被拒', badTime.code !== 0, badTime.msg);

  const reversed = await api('/attendance/rule', U.manager,
    { work_on_time: '18:00', work_off_time: '09:05', earliest_on: '06:30' });
  check('18 下班早于上班被拒', reversed.code !== 0, reversed.msg);

  const good = await api('/attendance/rule', U.manager, {
    work_on_time: '09:05', work_off_time: '18:00', late_grace: 0, earliest_on: '06:30',
    need_photo: true, need_location: true, makeup_max_days: 7, makeup_max_month: 3,
  });
  check('19 管理员保存规则成功', good.code === 0 && good.data.source === 'db',
    good.data && `source=${good.data.source}`);

  const rule1 = await api('/attendance/rule', U.liran);
  check('20 规则保存后立即生效', rule1.code === 0 && rule1.data.work_on_time === '09:05' && rule1.data.source === 'db',
    rule1.data && `${rule1.data.work_on_time} source=${rule1.data.source}`);

  // ---------- 7. 清理：恢复默认规则，避免留下测试痕迹 ----------
  try {
    mongo('db.oa_attendance_rule.deleteMany({})');
    console.log('  (已清理测试规则，回到环境变量默认值)');
  } catch (e) { console.log('  (清理提示)', e.message.slice(0, 80)); }

  console.log(`\n===== 考勤异常/规则回归：通过 ${pass} / 失败 ${fail} =====`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => {
  console.error('脚本异常:', e);
  process.exit(2);
});
