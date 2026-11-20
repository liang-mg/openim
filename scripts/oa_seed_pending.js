'use strict';
// 造一条待组长查阅的日报（含附件），并把空内容提交的校验也验证一遍
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
  const res = await fetch(OA + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', token },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return JSON.parse(await res.text());
}

const EMP = '2158780278';
const MGR = '9283941092';

(async () => {
  const tE = jwt(EMP), tM = jwt(MGR);
  const d = new Date();
  const period = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  // 校验 1：空 period 应被拒
  const bad1 = await api('/report/submit', tE, { type: 'daily', period: '', content: { done: 'x', plan: '', issues: '' }, status: 'submitted' });
  console.log('空日期提交 ->', bad1.code === 0 ? 'FAIL(仍被接受)' : `PASS(${bad1.msg})`);

  // 校验 2：提交但今日完成为空应被拒
  const bad2 = await api('/report/submit', tE, { type: 'daily', period, content: { done: '   ', plan: '', issues: '' }, status: 'submitted' });
  console.log('空内容提交 ->', bad2.code === 0 ? 'FAIL(仍被接受)' : `PASS(${bad2.msg})`);

  // 草稿允许空内容
  const draft = await api('/report/submit', tE, { type: 'daily', period, content: { done: '', plan: '', issues: '' }, status: 'draft' });
  console.log('空内容存草稿 ->', draft.code === 0 ? 'PASS(允许)' : `FAIL(${draft.msg})`);

  // 正式提交（覆盖同 period 草稿），带附件
  const sub = await api('/report/submit', tE, {
    type: 'daily',
    period,
    content: {
      done: '1. 完成工作台首页改版，顶部打卡卡与待办并排，宽屏下内容区已占满。\n2. 打卡页接入服务端时间，迟到判定不再依赖本地时钟。\n3. 日报页支持附件拖拽上传，单文件限制 20MB。',
      plan: '1. 推进日报两级审阅的点评模板。\n2. 补充打卡记录的月度统计视图。',
      issues: '附件目前存 OSS 直传，大文件偶尔超时，计划增加分片重试。',
    },
    attachments: [{ name: '工作台改版稿.png', size: 284000, file_type: 'image/png', url: '/oa/files/demo-work.png' }],
    status: 'submitted',
  });
  console.log('正式提交 ->', sub.code === 0 ? `PASS(${sub.data.report_id} ${sub.data.status})` : `FAIL(${sub.msg})`);
  console.log('REPORT_ID=' + (sub.data && sub.data.report_id));
  console.log('PERIOD=' + period);
})().catch((e) => { console.error(e); process.exit(1); });
