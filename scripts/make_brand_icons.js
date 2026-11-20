#!/usr/bin/env node
/**
 * 用无头 Chrome 渲染「新博」图标（多尺寸）。
 *
 * 为什么不用 --window-size：Chrome headless 有最小窗口宽度（约 500px），
 * 传 48/72/96 时实际视口仍接近 500，截图只截左上角一块，文字会被裁掉。
 * 这里改用 CDP 的 Emulation.setDeviceMetricsOverride 精确设置视口 + clip 截图。
 *
 * 用法：node scripts/make_brand_icons.js
 * 产物：frontend-custom/brand/icon-<size>.png
 */
'use strict';

const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9351;
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'frontend-custom', 'brand', 'icon-source.html');
const OUT_DIR = path.join(ROOT, 'frontend-custom', 'brand');
const SIZES = [512, 192, 144, 128, 96, 72, 64, 48, 32];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'icons-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
      '--window-size=1024,1024',
      '--hide-scrollbars',
      'file:///' + SOURCE.replace(/\\/g, '/'),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  );

  let chromeErr = '';
  chrome.stderr.on('data', (d) => {
    chromeErr += d;
  });
  chrome.on('exit', (code) => {
    if (code !== 0 && code !== null) console.log(`[chrome 退出 ${code}] ${chromeErr.slice(0, 300)}`);
  });

  let target = null;
  let lastErr = '';
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      target = list.find((t) => t.type === 'page');
      if (target) break;
      lastErr = `targets=${list.map((t) => t.type).join(',')}`;
    } catch (e) {
      lastErr = e.message;
    }
    await sleep(200);
  }
  if (!target) {
    console.log('FAIL: Chrome 未就绪 —', lastErr, chromeErr.slice(0, 300));
    chrome.kill();
    process.exit(1);
  }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    }
  });
  const send = (method, params) =>
    new Promise((res) => {
      const i = ++id;
      pending.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send('Page.enable');
  await send('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  await send('Page.navigate', { url: 'file:///' + SOURCE.replace(/\\/g, '/') });
  await sleep(1500);

  for (const size of SIZES) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: size, height: size, deviceScaleFactor: 1, mobile: false,
    });
    await sleep(350);
    const shot = await send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
      captureBeyondViewport: false,
    });
    const out = path.join(OUT_DIR, `icon-${size}.png`);
    fs.writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
    console.log(`icon-${size}.png  ${fs.statSync(out).size} B`);
  }

  await send('Emulation.clearDeviceMetricsOverride');
  chrome.kill();
  setTimeout(() => process.exit(0), 200);
})();
