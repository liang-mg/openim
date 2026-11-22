#!/usr/bin/env bash
# 切换 H5 dev 的默认接口环境（写入 gitignore 的 .env.dev.local）。
# 用法：bash scripts/use-env.sh local|online
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODE="${1:-local}"
FILE="$ROOT/.env.dev.local"
case "$MODE" in
  local)
    cat > "$FILE" <<'ENV'
# 本地联调：5174 被其他项目占用，改用 5180
VITE_DEV_PORT=5180

# 本地接口（默认同源 /oa /chat /api，不走 /proxy）
ENV
    ;;
  online)
    cat > "$FILE" <<'ENV'
# 本地联调：5174 被其他项目占用，改用 5180
VITE_DEV_PORT=5180

# 线上接口：H5 dev 通过 vite /proxy 反代到 https://im.9ty.lol
VITE_APP_ORIGIN=https://im.9ty.lol
ENV
    ;;
  *)
    echo "用法: bash scripts/use-env.sh local|online" >&2
    exit 1
    ;;
esac
echo "已写入 $FILE（$MODE）。请重启 uni dev server 后生效。"
