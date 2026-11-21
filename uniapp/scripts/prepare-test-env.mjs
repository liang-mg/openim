#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const tokenScript = path.resolve(ROOT, "..", ".local", "mint-token.js");
const output = path.join(ROOT, ".env.production.local");
const userID = "7559659175"; // 王经理：leader + is_admin

function isPrivateIPv4(address) {
  const parts = String(address || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  return parts[0] === 10 || parts[0] === 192 && parts[1] === 168 || parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
}

function findLanAddress() {
  const candidates = Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) => (entries || []).map((entry) => ({ name, ...entry })))
    .filter((entry) => (entry.family === "IPv4" || entry.family === 4) && !entry.internal && isPrivateIPv4(entry.address));
  // 公司/家庭局域网通常为 192.168.x.x；有多个网卡时优先它，避开 VPN 的 10.x 网段。
  candidates.sort((a, b) => Number(b.address.startsWith("192.168.")) - Number(a.address.startsWith("192.168.")));
  return candidates[0] && candidates[0].address;
}

const configuredOrigin = String(process.env.OA_TEST_ORIGIN || "").replace(/\/$/, "");
const lanAddress = findLanAddress();
if (!configuredOrigin && !lanAddress) {
  throw new Error("未找到可供手机访问的局域网 IPv4；请设置 OA_TEST_ORIGIN=https://你的后端地址");
}
const origin = configuredOrigin || `http://${lanAddress}:10010`;

if (!fs.existsSync(tokenScript)) throw new Error(`缺少本机 token 模板：${tokenScript}`);
const tokenSource = fs.readFileSync(tokenScript, "utf8");
const secret = tokenSource.match(/createHmac\("sha256",\s*"([^"]+)"\)/)?.[1];
if (!secret) throw new Error("无法从本机 token 模板读取签名配置");

const b64 = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const header = b64({ alg: "HS256", typ: "JWT" });
const payload = b64({ UserID: userID, UserType: 1, PlatformID: 5, iat: now, exp: now + 604800 });
const signature = crypto.createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url");
const token = `${header}.${payload}.${signature}`;

fs.writeFileSync(
  output,
  [
    "# 自动生成的本机测试包配置；已被 .gitignore 忽略，禁止提交",
    `VITE_APP_ORIGIN=${origin}`,
    "VITE_IM_MODE=mock",
    `VITE_DEV_TOKEN=${token}`,
    `VITE_DEV_USER_ID=${userID}`,
    "",
  ].join("\n"),
  { encoding: "utf8", mode: 0o600 },
);

process.stdout.write(`TEST_ENV_OK origin=${origin} user=王经理(${userID}) expiresIn=7d\n`);
