/**
 * 账号密码登录回归（5173 同源链路）
 * 用法：node scripts/oa_login_check.js
 * 覆盖：登录页无邮箱/验证码入口、六个测试账号密码登录、OA 角色与可见范围、
 *       错误密码拒绝、停用账号即时拦截与恢复。
 * 自清理：结尾一定恢复被停用的账号，不留下停用状态。
 */
const crypto = require('crypto');

const WEB = process.env.OA_WEB_URL || 'http://127.0.0.1:5173';
const PASSWORD = process.env.OA_TEST_PASSWORD || 'Xinbo@2026';
const PWD_MD5 = crypto.createHash('md5').update(PASSWORD).digest('hex');

const ACCOUNTS = [
  { phone: '12345678001', name: '李然', role: 'employee', team: false, admin: false },
  { phone: '12345678911', name: '张明', role: 'employee', team: false, admin: false },
  { phone: '12345678912', name: '王强', role: 'manager', team: true, admin: false },
  { phone: '19306860353', name: '王经理', role: 'leader', team: true, admin: true },
  { phone: '12345678002', name: '陈晓', role: 'employee', team: false, admin: false },
  { phone: '12345678003', name: '刘洋', role: 'manager', team: true, admin: false },
];

const CHENXIAO_ID = '7336036568';
const ADMIN_PHONE = '19306860353';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log('PASS ', name, detail ? '- ' + detail : '');
  } else {
    fail++;
    console.log('FAIL ', name, detail ? '- ' + detail : '');
  }
}

async function json(path, options) {
  const r = await fetch(WEB + path, options);
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { code: -1, errCode: -1, raw: text.slice(0, 160) };
  }
}

function loginBody(phone, password) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', operationID: 'oa-login-check-' + Date.now() },
    body: JSON.stringify({ phoneNumber: phone, areaCode: '+86', password, platform: 5 }),
  };
}

async function login(phone, password = PWD_MD5) {
  const d = await json('/chat/account/login', loginBody(phone, password));
  if (d.errCode !== 0) return { ok: false, msg: d.errMsg || d.errDlt || ('errCode=' + d.errCode) };
  return { ok: true, token: d.data.chatToken, userID: d.data.userID };
}

async function me(token) {
  return json('/oa/api/v1/me', { headers: { token } });
}

function post(path, token, body) {
  return json(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: JSON.stringify(body),
  });
}

(async () => {
  console.log('目标:', WEB, '账号:', ACCOUNTS.length, '个');

  // 1. 登录页确实是账号密码，没有邮箱和验证码入口
  const formRes = await fetch(WEB + '/src/pages/login/LoginForm.tsx');
  const formSrc = await formRes.text();
  check('登录页包含账号密码登录标识', formSrc.includes('账号密码登录'));
  check('登录页不再调用发验证码接口', !formSrc.includes('useSendSms') && !formSrc.includes('code/send'));
  check('登录页没有邮箱字段', !/"email"/.test(formSrc) && !formSrc.includes('placeholder.email'));

  // 2. 六个账号都能用账号密码登录，角色与可见范围来自 OA 档案
  const tokens = {};
  for (const a of ACCOUNTS) {
    const r = await login(a.phone);
    if (!r.ok) {
      check(a.name + ' 账号密码登录', false, r.msg);
      continue;
    }
    tokens[a.phone] = r.token;
    check(a.name + ' 账号密码登录', true, 'userID=' + r.userID);
    const m = await me(r.token);
    const d = m.data || {};
    check(
      a.name + ' OA 身份与权限',
      m.code === 0 && d.real_name === a.name && d.role === a.role &&
        !!d.can_view_team === a.team && !!d.is_admin === a.admin,
      'role=' + d.role + ' team=' + d.can_view_team + ' admin=' + d.is_admin,
    );
  }

  // 3. 错误密码必须被拒
  const bad = await login(ADMIN_PHONE, crypto.createHash('md5').update('wrong-password').digest('hex'));
  check('错误密码被拒绝', !bad.ok, bad.msg ? 'msg=' + bad.msg.slice(0, 60) : '');

  // 4. 停用账号即时拦截（旧 token 也必须立刻失效），然后恢复
  const adminToken = tokens[ADMIN_PHONE];
  const chenToken = tokens['12345678002'];
  if (!adminToken || !chenToken) {
    check('停用账号拦截', false, '前置登录失败，跳过');
  } else {
    let restored = false;
    try {
      const off = await post('/oa/api/v1/admin/employee/disable', adminToken, { user_id: CHENXIAO_ID, disabled: true });
      check('管理员停用账号', off.code === 0, off.msg || '');
      const blocked = await me(chenToken);
      check('停用后旧 token 被拒绝', blocked.code === 403, 'code=' + blocked.code);
    } finally {
      const on = await post('/oa/api/v1/admin/employee/disable', adminToken, { user_id: CHENXIAO_ID, disabled: false });
      restored = on.code === 0;
      check('恢复账号', restored, on.msg || '');
      if (restored) {
        const back = await me(chenToken);
        check('恢复后可继续访问', back.code === 0, 'code=' + back.code);
      }
    }
  }

  console.log('\n结果: ' + pass + ' 通过 / ' + fail + ' 失败');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('执行失败:', e);
  process.exit(1);
});
