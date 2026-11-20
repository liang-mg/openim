// 造工作台待办演示数据：
//   张明 11-17 提交后停在「待王强点评」
//   李然 11-15 提交 → 王强点评并上报 → 停在「待王经理审阅」
const crypto = require("crypto");

const BASE = "http://127.0.0.1:10010/oa/api/v1";
const SECRET = process.env.OA_TOKEN_SECRET || '<CHANGE_ME_OA_TOKEN_SECRET>';

const U = {
  liran: "2158780278",
  zhangming: "7474479331",
  wangqiang: "9283941092",
  wangjingli: "7559659175",
};
const NAME = {
  [U.liran]: "李然",
  [U.zhangming]: "张明",
  [U.wangqiang]: "王强(组长)",
  [U.wangjingli]: "王经理(领导)",
};

function token(uid) {
  const b64 = (x) =>
    Buffer.from(x).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const now = Math.floor(Date.now() / 1000);
  const h = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64(JSON.stringify({ UserID: uid, Platform: "Web", exp: now + 86400, iat: now, nbf: now - 10 }));
  const s = crypto.createHmac("sha256", SECRET).update(`${h}.${p}`).digest("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${h}.${p}.${s}`;
}

async function api(path, uid, body) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "Content-Type": "application/json", token: token(uid) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
}

async function seed(uid, period, done) {
  const res = await api("/report/submit", uid, {
    type: "daily",
    period,
    content: { done, plan: "继续跟进 OA 联调", issues: "" },
    attachments: [],
    status: "submitted",
  });
  return res;
}

(async () => {
  // 1. 张明 11-17：待组长点评
  let r = await seed(U.zhangming, "2026-11-17", "完成考勤接口联调，修复重复打卡判断\n补充日报导出字段");
  console.log("张明 11-17 提交:", r.code === 0 ? `OK ${r.data.status}` : `跳过(${r.msg})`);
  const zmReport = r.code === 0 ? r.data.report_id : null;

  // 2. 李然 11-15：提交后由组长点评并上报
  r = await seed(U.liran, "2026-11-15", "梳理两级审阅状态机，补 4 个边界用例\n完成查阅页归档态改造");
  console.log("李然 11-15 提交:", r.code === 0 ? `OK ${r.data.status}` : `跳过(${r.msg})`);
  const lrReport = r.code === 0 ? r.data.report_id : null;

  if (lrReport) {
    let x = await api("/report/review", U.wangqiang, {
      report_id: lrReport,
      comment: "结构清晰，边界用例补得不错，上报领导。",
      view: "manager",
    });
    console.log("王强点评:", x.code === 0 ? "OK" : x.msg);
    x = await api("/report/escalate", U.wangqiang, { report_id: lrReport });
    console.log("王强上报:", x.code === 0 ? "OK" : x.msg);
  }

  // 3. 四个角色看工作台
  for (const uid of [U.liran, U.zhangming, U.wangqiang, U.wangjingli]) {
    const s = await api("/workbench/summary", uid);
    console.log(`\n== ${NAME[uid]} 待办 ${s.data.count} 条`);
    s.data.todos.forEach((t) => console.log(`   - ${t.text} → ${t.action} ${t.path}`));
  }
  if (zmReport) console.log("\n张明待点评日报:", zmReport);
})();
