'use strict';
// 四个账号的权限矩阵实测：每个账号能看到什么、能做什么
const crypto = require('crypto');
const OA = 'http://127.0.0.1:10010/oa/api/v1';
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';
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

const USERS = [
  ['12345678001', '2158780278', '李然'],
  ['12345678911', '7474479331', '张明'],
  ['12345678912', '9283941092', '王强'],
  ['19306860353', '7559659175', '王经理'],
];

(async () => {
  for (const [phone, uid, expectName] of USERS) {
    const t = jwt(uid);
    const me = await api('/me', t);
    const ov = await api('/report/overview', t);
    const mine = ((ov.data && ov.data.recent) || []).length;
    const mgrList = await api('/report/review-list?view=manager', t);
    const mgrTotal = (mgrList.data && mgrList.data.total) || 0;
    const ldrList = await api('/report/review-list?view=leader', t);
    const ldrTotal = (ldrList.data && ldrList.data.total) || 0;
    const all = await api('/report/all-for-review', t);
    const allTotal = Array.isArray(all.data) ? all.data.length : 0;

    // 归档权限探测：随便拿一条看报什么错（不实际改状态时用不存在的 id）
    const arch = await api('/report/archive', t, { report_id: 'probe_not_exist' });
    const archDenied = arch.code !== 0;

    console.log(
      [
        phone.padEnd(12),
        (me.data.real_name || '?').padEnd(8),
        (me.data.role || '?').padEnd(9),
        `自己日报:${mine}`.padEnd(10),
        `待我点评:${mgrTotal}`.padEnd(12),
        `待我审批(领导):${ldrTotal}`.padEnd(16),
        `查阅页可见:${allTotal}`.padEnd(14),
        `归档探测:${archDenied ? '被拒' : '通过'}`,
      ].join(' '),
    );
  }
})().catch((e) => { console.error(e); process.exit(1); });
