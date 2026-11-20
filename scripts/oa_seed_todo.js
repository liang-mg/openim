'use strict';
// 造两条待办演示数据：李然待组长点评、张明待领导查阅
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
function dayOffset(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const LIRAN = '2158780278', ZHANGMING = '7474479331', MGR = '9283941092';

(async () => {
  const tL = jwt(LIRAN), tZ = jwt(ZHANGMING), tM = jwt(MGR);

  // 1) 李然 · 前天：停在 submitted，等王强点评
  const r1 = await api('/report/submit', tL, {
    type: 'daily',
    period: dayOffset(2),
    content: {
      done: '1. 完成工作台的宽屏布局，打卡卡与待办改为横向分栏。\n2. 拍照打卡页接入摄像头，授权失败时降级为模拟照片。\n3. 修掉日报页输入框在窄屏下的换行错位。',
      plan: '1. 和组长对一下日报点评的文案模板。\n2. 补齐打卡记录的月度视图。',
      issues: '摄像头在部分安卓机需要 HTTPS 才能调用，目前内网 http 无法拍照。',
    },
    attachments: [],
    status: 'submitted',
  });
  console.log('李然待点评:', r1.code === 0 ? `${r1.data.period} ${r1.data.status}` : r1.msg);

  // 2) 张明 · 昨天：组长点评后上报，停在 pending_leader，等王经理查阅
  const r2 = await api('/report/submit', tZ, {
    type: 'daily',
    period: dayOffset(1),
    content: {
      done: '1. 打卡接口加上同日同类型的唯一索引，并发重复提交会被拦下。\n2. 迟到早退判定改为服务端时间，避免改本机时钟。\n3. 日报列表接口补了汇报链过滤。',
      plan: '1. 做请假申请的表结构和接口。\n2. 补卡的审批状态机复用日报那套。',
      issues: '考勤规则现在写死在代码里，需要做成管理端可配置。',
    },
    attachments: [],
    status: 'submitted',
  });
  console.log('张明提交:', r2.code === 0 ? `${r2.data.period} ${r2.data.status}` : r2.msg);

  if (r2.code === 0) {
    const rv = await api('/report/review', tM, { report_id: r2.data.report_id, comment: '后端质量不错，请假和补卡的表结构想好再动手，别急着写接口。', view: 'manager' });
    const esc = await api('/report/escalate', tM, { report_id: r2.data.report_id });
    console.log('组长点评上报:', rv.code === 0 && esc.code === 0 ? esc.data.status : `${rv.msg}/${esc.msg}`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
