#!/usr/bin/env bash
# ============================================================================
# IM 底座自愈脚本
#
# 适用症状：
#   - oa-web 反复 Restarting，日志报 host not found in upstream "openim-server"
#   - openim-server / openim-chat / redis / etcd 容器缺失或没启动
#   - 页面打不开 / 登录失败（根因是 IM 服务没起，不是 OA 本身）
#
# 用法：在 oa-custom 根目录执行：
#   bash deploy/selfheal.sh
#
# 说明：
#   - 大镜像（openim-server ~640MB）拉取中断后重跑本脚本可续传，已下的层会复用。
#   - 最后重建 oa-web 让 nginx 的「动态解析上游」配置生效（需先 git pull 到最新版）。
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BASE_DIR="$OA_DIR/base"
BASE_COMPOSE="$BASE_DIR/docker-compose.yaml"
COMPOSE_OA="$OA_DIR/deploy/docker-compose.oa.yaml"
COMPOSE_BRAND="$OA_DIR/deploy/docker-compose.brand.yaml"
ENV_FILE="${OA_ENV:-$OA_DIR/.env}"

ok()   { printf '  [OK] %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ]        || fail "缺少 $ENV_FILE"
[ -f "$BASE_COMPOSE" ]    || fail "缺少底座编排 $BASE_COMPOSE"
[ -f "$COMPOSE_OA" ]      || fail "缺少 $COMPOSE_OA"
[ -f "$COMPOSE_BRAND" ]   || fail "缺少 $COMPOSE_BRAND"

step "1/3 拉全底座与 IM 镜像（大镜像，中断后重跑可续传）"
docker compose -f "$BASE_COMPOSE" --env-file "$ENV_FILE" pull \
  mongo minio redis etcd kafka openim-server openim-chat \
  || fail "镜像拉取失败，检查网络后重跑本脚本。"

step "2/3 启动底座 + IM 服务（openim-server/chat）"
docker compose -f "$BASE_COMPOSE" --env-file "$ENV_FILE" up -d \
  mongo minio redis etcd kafka openim-server openim-chat \
  || fail "IM 服务启动失败，执行 docker logs openim-server 排查。"
ok "IM 服务已提交启动（openim-server 约 5 分钟观察期，chat 随后就绪）"

step "3/3 重建 oa-web（应用 nginx 动态解析上游，页面不再因上游缺失而崩）"
docker compose -f "$BASE_COMPOSE" -f "$COMPOSE_OA" -f "$COMPOSE_BRAND" \
  --env-file "$ENV_FILE" up -d --force-recreate --build oa-web \
  || fail "oa-web 重建失败，执行 deploy.sh logs oa-web 排查。"

echo ""
echo "============================================================"
ok "自愈完成"
echo "  openim-server 约 5 分钟后健康，openim-chat 自动就绪。"
echo "  验证容器： docker compose -f '$BASE_COMPOSE' --env-file '$ENV_FILE' ps"
echo "  验证前端： curl -I http://127.0.0.1:5173"
echo "============================================================"
