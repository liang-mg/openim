'use strict';
// 员工与权限管理接口校验
const crypto = require('crypto');
const OA = 'http://127.0.0.1:10010/oa/api/v1';
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
const MONGO_PW = process.env.MONGO_PASSWORD || '<CHANGE_ME_MONGO_PASSWORD>';

const b64 = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function jwt(uid) {
  const n = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: 'Web', exp: n + 86400, iat: n, nbf: n - 10 }));
  const s = crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${h}.${p}.${s}`;
}
async function api(path, token, body) {
  const r = await fetch(OA + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return JSON.parse(await r.text());
}

const LEADER = '7559659175';  // 王经理，is_admin
const MGR = '9283941092';     // 王强，非管理员
const EMP = '2158780278';     // 李然

const results = [];
function rec(name, ok, detail) {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

(async () => {
  const tL = jwt(LEADER), tM = jwt(MGR), tE = jwt(EMP);

  const meL = await api('/me', tL);
  rec('/me 带 is_admin', meL.data.is_admin === true, `role=${meL.data.role} is_admin=${meL.data.is_admin}`);

  const meM = await api('/me', tM);
  rec('/me 组长非管理员', meM.data.is_admin === false, `is_admin=${meM.data.is_admin}`);

  const denyM = await api('/admin/employees', tM);
  rec('组长访问员工列表被拒', denyM.code !== 0, denyM.msg);

  const denyE = await api('/admin/im-users', tE);
  rec('员工访问 IM 账号被拒', denyE.code !== 0, denyE.msg);

  const list = await api('/admin/employees', tL);
  rec('管理员读取员工列表', list.code === 0 && list.data.total >= 4,
    `total=${list.data && list.data.total} depts=${JSON.stringify(list.data && list.data.departments)}`);
  const first = list.data && list.data.list && list.data.list[0];
  rec('列表带手机号', !!(first && first.phone_number), first ? `${first.real_name} ${first.phone_number}` : 'n/a');

  const im = await api('/admin/im-users', tL);
  rec('读取 IM 候选账号', im.code === 0 && Array.isArray(im.data) && im.data.length > 0,
    `count=${Array.isArray(im.data) ? im.data.length : 'n/a'}`);
  const withProfile = (im.data || []).filter((u) => u.has_profile).length;
  rec('候选里标记了已有档案', withProfile > 0, `has_profile=${withProfile}`);

  // 找一个还没档案的 IM 账号来加
  const candidate = (im.data || []).find((u) => !u.has_profile);
  if (!candidate) {
    rec('存在可添加的候选账号', false, '没有未建档的 IM 账号');
  } else {
    const add = await api('/admin/employee/save', tL, {
      user_id: candidate.user_id, real_name: '测试员工', department: '测试部',
      position: '测试岗', role: 'employee', manager_id: MGR, is_admin: false,
    });
    rec('新增员工', add.code === 0, `uid=${candidate.user_id} ${add.msg || ''}`);

    const dup = await api('/admin/employee/save', tL, {
      user_id: candidate.user_id, real_name: '测试员工改名', department: '测试部',
      position: '测试岗', role: 'employee', manager_id: MGR, is_admin: false,
    });
    rec('同账号再次保存=更新而非新增', dup.code === 0 && dup.data.real_name === '测试员工改名');

    const selfMgr = await api('/admin/employee/save', tL, {
      user_id: candidate.user_id, real_name: '测试员工', department: '测试部',
      role: 'employee', manager_id: candidate.user_id,
    });
    rec('上级设成自己被拒', selfMgr.code !== 0, selfMgr.msg);

    const loop = await api('/admin/employee/save', tL, {
      user_id: MGR, real_name: '王强', department: '技术部', position: '技术组长',
      role: 'manager', manager_id: candidate.user_id,
    });
    rec('形成环被拒（王强上级设为测试员工）', loop.code !== 0, loop.msg);

    const badRole = await api('/admin/employee/save', tL, {
      user_id: candidate.user_id, real_name: '测试员工', department: '测试部',
      role: 'boss', manager_id: '',
    });
    rec('非法角色被拒', badRole.code !== 0, badRole.msg);

    const noDept = await api('/admin/employee/save', tL, {
      user_id: candidate.user_id, real_name: '测试员工', department: '',
      role: 'employee', manager_id: '',
    });
    rec('部门为空被拒', noDept.code !== 0, noDept.msg);

    // 停用：该员工没有下属，应可停用
    const dis = await api('/admin/employee/disable', tL, { user_id: candidate.user_id, disabled: true });
    rec('停用员工', dis.code === 0, dis.msg || '');

    const listNo = await api('/admin/employees', tL);
    const hidden = !(listNo.data.list || []).some((e) => e.user_id === candidate.user_id);
    rec('停用后默认不在列表', hidden);

    const listAll = await api('/admin/employees?include_disabled=1', tL);
    const shown = (listAll.data.list || []).some((e) => e.user_id === candidate.user_id && e.disabled);
    rec('含停用时可看到且标记 disabled', shown);

    // 组长下拉不应再出现停用的人
    const ids = await api('/report/review-list?view=manager', tM);
    rec('停用者不参与汇报链（接口正常）', ids.code === 0, `total=${ids.data && ids.data.total}`);

    const selfDis = await api('/admin/employee/disable', tL, { user_id: LEADER, disabled: true });
    rec('不能停用自己', selfDis.code !== 0, selfDis.msg);

    // 有在岗下属时不能停用
    const disMgr = await api('/admin/employee/disable', tL, { user_id: MGR, disabled: true });
    rec('有在岗下属时不能停用组长', disMgr.code !== 0, disMgr.msg);

    // 恢复启用并清理
    const en = await api('/admin/employee/disable', tL, { user_id: candidate.user_id, disabled: false });
    rec('重新启用', en.code === 0);
  }

  // 清理本脚本造出来的测试档案（真实姓名固定为「测试员工 / 测试员工改名」），
  // 否则它们会挂在组长名下，出现在「团队出勤 / 全公司报表」里。
  try {
    const { execSync } = require('child_process');
    execSync(
      'docker exec -i mongo mongosh -u openIM -p ' + MONGO_PW + ' --authenticationDatabase openim_v3 openim_v3 --quiet --eval "db.oa_employee.deleteMany({real_name:{$in:[\'测试员工\',\'测试员工改名\']}})"',
      { stdio: 'ignore' },
    );
    console.log('· 已清理测试员工档案');
  } catch (e) {
    console.log('· 测试员工档案需手工清理：', String(e.message).slice(0, 80));
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n==== ${results.length - failed.length}/${results.length} passed ====`);
  if (failed.length) console.log('FAILED: ' + failed.map((f) => f.name).join(' | '));
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
