#!/usr/bin/env bash
# ============================================================
# Android APK 云打包（HBuilderX CLI）
#
# 前提：
#   1. 本机已安装 HBuilderX（默认 /Applications/HBuilderX.app）
#   2. HBuilderX 已登录，且当前账号是 manifest.json 里 APPID 的所有者
#      或已被所有者加为项目成员（dev.dcloud.net.cn）
#   3. 已 npm run build:app（本脚本会自动检查）
#
# 用法：
#   bash scripts/pack-android.sh          # 云端证书（测试包，packtype=3）
#   bash scripts/pack-android.sh 0        # 自有证书（正式包，需自行配置证书）
#
# 环境变量：
#   HBUILDERX_CLI   HBuilderX CLI 路径
#   ANDROID_PACKAGE 包名，默认 com.xinbo.oa
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="${HBUILDERX_CLI:-/Applications/HBuilderX.app/Contents/MacOS/cli}"
PKG="${ANDROID_PACKAGE:-com.xinbo.oa}"
PACK_TYPE="${1:-3}"

if [ ! -x "$CLI" ]; then
  echo "找不到 HBuilderX CLI: $CLI" >&2
  exit 1
fi

APPID="$(node -e "const m=require('$ROOT/src/manifest.json'); process.stdout.write(m.appid || '')")"
echo "项目: $ROOT"
echo "APPID: $APPID"
echo "包名:  $PKG"
echo "证书:  $PACK_TYPE (3=云端证书/测试, 0=自有证书/正式)"
echo

if [ ! -f "$ROOT/dist/build/app/app-service.js" ]; then
  echo "==> 未发现 App 资源，先执行 npm run build:app"
  (cd "$ROOT" && npm run build:app)
fi

echo "==> 导入 HBuilderX 项目"
"$CLI" project open --path "$ROOT"

echo "==> 提交云打包"
"$CLI" pack --project "$ROOT" --platform android \
  --android.packagename "$PKG" --android.androidpacktype "$PACK_TYPE"

echo "==> 打包状态（下载地址以 CLI 输出为准；云端打包通常 10-30 分钟）"
"$CLI" pack status --project "$ROOT"
