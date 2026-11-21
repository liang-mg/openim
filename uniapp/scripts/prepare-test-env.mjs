#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const tokenScript = path.resolve(ROOT, "..", ".local", "mint-token.js");
const output = path.join(ROOT, ".env.production.local");
const userID = "7559659175"; // 王经理：leader + is_admin
const origin = "http://192.168.1.15:10010";

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
