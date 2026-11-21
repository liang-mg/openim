/**
 * 图片处理：打卡照片加水印（时间 + 姓名 + 位置）。
 *
 * 为什么要在客户端烧水印：PC 端 frontend/src/pages/checkin/index.tsx 就是这么做的，
 * 照片是「本人在这个时间、这个地点」的凭证，水印必须进图片本身，不能只做浮层。
 *
 * 实现用 uni 的 canvas 旧接口（createCanvasContext / canvasToTempFilePath），
 * H5 与 App 都支持，只有 nvue 不支持 —— 本项目不用 nvue。
 * 画布固定 720×960（竖图），原图按 cover 裁切，和 PC 的 object-fit: cover 一致。
 *
 * 体积控制（2026-11-21 与 PC 对齐）：PC 会把打卡图压到 300KB 以内
 * （scale 1 → .75 → .5 → .35 × quality .85 → .7 → .55 逐级尝试）。
 * 不压缩时一张 720×960 JPEG 的 base64 常有 500KB+，移动网络上传会明显变慢，
 * 后端也要多存一倍体积，所以这里照搬同一套上限。
 */
export const STAMP_W = 720;
export const STAMP_H = 960;
export const STAMP_CANVAS_ID = "stampCanvas";

/** 打卡照片上限，与 PC 的 MAX_PHOTO_BYTES 一致 */
export const MAX_PHOTO_BYTES = 300 * 1024;

const JPEG_PREFIX = "data:image/jpeg;base64,";

/**
 * 把任意图片路径转成 data URL（后端 submitCheckin 的 photo 只认 data URL）。
 *
 * 传统 uni-app App 的 JS 引擎没有 uni.getFileSystemManager，APK 必须走
 * HTML5+ 的 plus.io；小程序才使用 uni.getFileSystemManager。
 */
export function toDataURL(filePath) {
  return new Promise((resolve, reject) => {
    // #ifdef H5
    fetch(filePath)
      .then((res) => res.blob())
      .then((blob) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(blob);
      })
      .catch(() => reject(new Error("图片读取失败")));
    // #endif

    // #ifdef APP-PLUS
    try {
      const fail = () => reject(new Error("图片读取失败"));
      plus.io.resolveLocalFileSystemURL(
        filePath,
        (entry) => {
          entry.file((file) => {
            const reader = new plus.io.FileReader();
            reader.onloadend = (event) => {
              const result = String((event && event.target && event.target.result) || reader.result || "");
              if (result.startsWith("data:")) resolve(result);
              else fail();
            };
            reader.onerror = fail;
            reader.readAsDataURL(file);
          }, fail);
        },
        fail
      );
    } catch (e) {
      reject(new Error("图片读取失败"));
    }
    // #endif

    // #ifdef MP
    try {
      uni.getFileSystemManager().readFile({
        filePath,
        encoding: "base64",
        success: (res) => resolve(`${JPEG_PREFIX}${res.data}`),
        fail: () => reject(new Error("图片读取失败")),
      });
    } catch (e) {
      reject(new Error("当前平台不支持读取图片"));
    }
    // #endif
  });
}

function getImageInfo(src) {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({
      src,
      success: (info) => resolve(info),
      fail: () => reject(new Error("图片解析失败")),
    });
  });
}

function canvasToTempFile({ quality = 0.85, destWidth = STAMP_W, destHeight = STAMP_H } = {}) {
  return new Promise((resolve, reject) => {
    uni.canvasToTempFilePath(
      {
        canvasId: STAMP_CANVAS_ID,
        x: 0,
        y: 0,
        width: STAMP_W,
        height: STAMP_H,
        destWidth,
        destHeight,
        fileType: "jpg",
        quality,
        success: (res) => resolve(res.tempFilePath),
        fail: (err) => reject(new Error((err && err.errMsg) || "生成水印图片失败")),
      },
      null
    );
  });
}

/** base64 字符串对应的字节数（含 padding 修正） */
function base64Bytes(dataUrl) {
  const at = dataUrl.indexOf(",");
  const b64 = at >= 0 ? dataUrl.slice(at + 1) : dataUrl;
  const pad = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

/**
 * 按 PC 同一套策略压到 300KB 以内：先降质量，再降分辨率。
 * 返回最后一个候选（全都不达标时也只能用它，总比打卡失败强）。
 */
async function encodeWithinBudget() {
  let last = "";
  for (const scale of [1, 0.75, 0.5, 0.35]) {
    const destWidth = Math.max(1, Math.round(STAMP_W * scale));
    const destHeight = Math.max(1, Math.round(STAMP_H * scale));
    for (const quality of [0.85, 0.7, 0.55]) {
      const tempPath = await canvasToTempFile({ quality, destWidth, destHeight });
      const dataUrl = await toDataURL(tempPath);
      last = dataUrl;
      if (base64Bytes(dataUrl) <= MAX_PHOTO_BYTES) return dataUrl;
    }
  }
  return last;
}

/**
 * 给照片加水印，返回 data URL（已尽量压到 300KB 以内）。
 * 任何一步失败都会退化成「原图 data URL」，保证打卡不会因为水印卡死。
 */
export async function stampPhoto(filePath, stampText) {
  try {
    const info = await getImageInfo(filePath);
    const sw = info.width || STAMP_W;
    const sh = info.height || STAMP_H;

    // cover：短边铺满，长边居中裁切
    const scale = Math.max(STAMP_W / sw, STAMP_H / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    const dx = (STAMP_W - dw) / 2;
    const dy = (STAMP_H - dh) / 2;

    const ctx = uni.createCanvasContext(STAMP_CANVAS_ID);
    ctx.drawImage(filePath, dx, dy, dw, dh);

    // 底部半透明条 + 白字，与 PC 的比例一致（56px @ 屏幕宽 ≈ 96px @ 720）
    const barH = 96;
    ctx.setFillStyle("rgba(0,0,0,0.5)");
    ctx.fillRect(0, STAMP_H - barH, STAMP_W, barH);
    ctx.setFillStyle("#ffffff");
    ctx.setFontSize(24);
    const text = String(stampText || "");
    ctx.fillText(text.length > 46 ? `${text.slice(0, 46)}…` : text, 20, STAMP_H - 34);

    await new Promise((resolve) => ctx.draw(false, resolve));
    return await encodeWithinBudget();
  } catch (e) {
    console.warn("[checkin] 水印生成失败，退回原图", e);
    return await toDataURL(filePath);
  }
}

export default { stampPhoto, toDataURL, STAMP_W, STAMP_H, STAMP_CANVAS_ID, MAX_PHOTO_BYTES };
