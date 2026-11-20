'use strict';
// 完整链路演示数据：张明提交 -> 组长点评上报 -> 领导点评归档
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

const EMP = '7474479331';   // 张明
const MGR = '9283941092';   // 王强
const LEADER = '7559659175'; // 王经理

(async () => {
  const tE = jwt(EMP), tM = jwt(MGR), tL = jwt(LEADER);
  const d = new Date();
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const sub = await api('/report/submit', tE, {
    type: 'daily', period,
    content: {
      done: '1. 完成打卡记录接口的月度分页查询，补了空数据兜底。\n2. 修复组长越权归档的问题，归档接口改为仅领导可用。\n3. 给日报提交加了必填校验，避免空日报进入审阅队列。',
      plan: '1. 做请假申请的建表与接口。\n2. 和前端对一下补卡入口的交互。',
      issues: 'MongoDB 建索引在数据量大时需要走后台模式，后续要评估。',
    },
    attachments: [],
    status: 'submitted',
  });
  console.log('员工提交:', sub.code === 0 ? sub.data.report_id : sub.msg);
  const rid = sub.data.report_id;

  const rv = await api('/report/review', tM, { report_id: rid, comment: '后端这块改得扎实，请假接口注意和打卡的关联模型。', view: 'manager' });
  console.log('组长点评:', rv.code === 0 ? 'ok' : rv.msg);
  const esc = await api('/report/escalate', tM, { report_id: rid });
  console.log('组长上报:', esc.code === 0 ? esc.data.status : esc.msg);

  const lv = await api('/report/review', tL, { report_id: rid, comment: '同意组长意见，请假功能优先级提到本周。', view: 'leader' });
  console.log('领导点评:', lv.code === 0 ? 'ok' : lv.msg);
  const ar = await api('/report/archive', tL, { report_id: rid });
  console.log('领导归档:', ar.code === 0 ? ar.data.status : ar.msg);
  console.log('REPORT_ID=' + rid);
})().catch((e) => { console.error(e); process.exit(1); });
