#!/usr/bin/env bash
# ============================================================================
# OA 二开环境一键部署脚本
#
#   deploy.sh bootstrap   # 首次全流程：预检 -> 密钥 -> 镜像内编译+构建 -> 启动 -> 验收
#   deploy.sh up          # 启动/重建 OA 服务
#   deploy.sh down        # 停止 OA 服务（不动官方底座）
#   deploy.sh restart     # 重启 OA 服务
#   deploy.sh build       # 重建镜像（Go 编译在 Dockerfile 内完成）
#   deploy.sh status      # 查看容器与端口状态
#   deploy.sh logs        # 跟踪 OA 服务日志
#   deploy.sh verify      # 健康检查 + 接口冒烟
#
# 前提：在 openim-docker 根目录的同级放好 oa-custom（本仓库）。
#       典型目录：
#         /work/openim-docker/            <- 官方底座（含 docker-compose.yaml）
#         /work/openim-docker/oa-custom/  <- 本仓库
#
# 可覆盖变量：
#   OA_COMPOSE  官方 compose 文件，默认自动探测
#   OA_ENV      .env 路径，默认 <官方底座>/.env
#   SKIP_BUILD  =1 跳过编译（已有镜像时用）
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OA_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"              # oa-custom 根目录
ROOT="$(cd "$OA_DIR/.." && pwd)"                    # 官方底座根目录
COMPOSE_OA="$OA_DIR/deploy/docker-compose.oa.yaml"
ENV_FILE="${OA_ENV:-$ROOT/.env}"
ENV_TEMPLATE="$OA_DIR/config-template/oa.env.example"

ok()   { printf '  [OK] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

# 探测官方 compose 文件
detect_compose() {
  if [ -n "${OA_COMPOSE:-}" ]; then echo "$OA_COMPOSE"; return; fi
  for c in "$ROOT/docker-compose.yaml" "$ROOT/docker-compose.yml"; do
    [ -f "$c" ] && { echo "$c"; return; }
  done
  fail "未找到官方 docker-compose.yaml。请在 openim-docker 根目录执行，或设 OA_COMPOSE 指定路径。"
}

# compose 统一入口：官方 + OA override
compose() {
  local base; base="$(detect_compose)"
  docker compose -f "$base" -f "$COMPOSE_OA" "$@"
}

preflight() {
  step "环境预检"
  command -v docker >/dev/null 2>&1 || fail "缺少 docker，请先安装 Docker / Docker Desktop。"
  docker info >/dev/null 2>&1 || fail "Docker 未运行，请先启动 Docker。"
  # Go 编译已内置到 Dockerfile 多阶段构建，宿主机无需安装 Go
  [ -f "$COMPOSE_OA" ] || fail "缺少 $COMPOSE_OA，检查仓库是否完整。"
  [ -f "$ENV_TEMPLATE" ] || fail "缺少配置模板 $ENV_TEMPLATE。"
  [ -f "$(detect_compose)" ] || fail "官方底座 compose 不存在。"
  ok "docker / compose / 模板 均就绪（Go 编译在镜像内完成，无需本地安装）"
  ok "官方底座: $ROOT"
  ok "OA 仓库:   $OA_DIR"
}

# 从模板生成 .env，并自动生成随机密钥（仅首次；已有 .env 不覆盖）
prepare_env() {
  step "准备 .env 配置"
  if [ -f "$ENV_FILE" ]; then
    ok "已存在 $ENV_FILE，保留不覆盖（如需重建请先备份删除）"
  else
    cp "$ENV_TEMPLATE" "$ENV_FILE"
    ok "已从模板生成 $ENV_FILE"

    # 生成随机密钥：统一一个 32 位串用于各密钥位，避免多处不一致
    local secret
    secret="$(openssl rand -hex 16 2>/dev/null || head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
    [ -n "$secret" ] || fail "无法生成随机密钥，请手动填写 $ENV_FILE"
    local host; host="$(hostname 2>/dev/null || echo 127.0.0.1)"

    # 批量替换占位符（跨平台 sed）
    sed_i() {
      if [ "$(uname)" = "Darwin" ]; then sed -i '' "$@"; else sed -i "$@"; fi
    }
    sed_i "s|<CHANGE_ME_MONGO_ROOT_PASSWORD>|$secret|g" "$ENV_FILE"
    sed_i "s|<CHANGE_ME_MONGO_PASSWORD>|$secret|g"        "$ENV_FILE"
    sed_i "s|<CHANGE_ME_REDIS_PASSWORD>|$secret|g"        "$ENV_FILE"
    sed_i "s|<CHANGE_ME_MINIO_SECRET>|$secret|g"          "$ENV_FILE"
    sed_i "s|<CHANGE_ME_OPENIM_SECRET>|$secret|g"         "$ENV_FILE"
    sed_i "s|<CHANGE_ME_OA_TOKEN_SECRET>|$secret|g"       "$ENV_FILE"
    sed_i "s|<CHANGE_ME_HOST>|$host|g"                    "$ENV_FILE"
    ok "已生成随机密钥并写入 .env（未提交、仅本地）"
    warn " chatToken secret 必须与 config/chat-rpc-admin.yml 一致；"
    warn " 若官方 chat 用固定 secret，请把 .env 的 XINBO_OA_TOKEN_SECRET 改成同一个值。"
  fi

  # 检查是否还有未替换的占位符（只看非注释配置行）
  if grep -vE '^[[:space:]]*#' "$ENV_FILE" 2>/dev/null | grep -q '<CHANGE_ME_'; then
    warn ".env 中仍有 <CHANGE_ME_*> 未填写，请手动补全：$ENV_FILE"
  fi
}

# 构建镜像（Dockerfile 多阶段构建会在镜像内完成 Go 编译，无需本地 Go）
build_image() {
  step "构建 xinbo-oa:local 镜像（镜像内编译 Go 后端）"
  docker build \
    --build-arg "GOPROXY=${GOPROXY:-https://goproxy.cn,direct}" \
    -t xinbo-oa:local "$OA_DIR/backend" >/dev/null \
    || fail "镜像构建失败（Go 编译在镜像内进行，检查网络/GOPROXY）。"
  ok "镜像 xinbo-oa:local 已就绪"
}

do_build() {
  preflight
  build_image
}

do_bootstrap() {
  step "OA 环境一键部署（首次全流程）"
  preflight
  prepare_env
  build_image

  step "启动依赖底座（mongo / minio）"
  local base; base="$(detect_compose)"
  docker compose -f "$base" --env-file "$ENV_FILE" up -d mongo minio \
    || fail "mongo/minio 启动失败，检查 $ENV_FILE 密码配置。"

  step "启动 OA 服务"
  compose --env-file "$ENV_FILE" up -d --force-recreate xinbo-oa \
    || fail "OA 服务启动失败，执行 deploy.sh logs 查看日志。"

  verify
  echo ""
  echo "============================================================"
  ok "OA 环境已就绪"
  echo "  后端健康检查: http://127.0.0.1:${XINBO_OA_PORT:-10010}/oa/api/v1/healthz"
  echo "  前端: 在 openim-electron-demo 执行 pnpm dev，打开 http://127.0.0.1:5173"
  echo "  回归: node oa-custom/scripts/oa_e2e_check.js"
  echo "============================================================"
}

verify() {
  step "验收检查"
  local port; port="$(grep -E '^XINBO_OA_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '\r')"
  port="${port:-10010}"
  local url="http://127.0.0.1:${port}/oa/api/v1/healthz"

  compose ps xinbo-oa 2>/dev/null | grep -q 'xinbo-oa' \
    && ok "容器已创建" || warn "容器状态异常，执行 deploy.sh status"

  for i in $(seq 1 20); do
    if curl -fsS "$url" >/dev/null 2>&1; then ok "健康检查通过: $url"; return 0; fi
    sleep 2
  done
  fail "健康检查失败（40 秒内无响应）。执行 deploy.sh logs 排查。"
}

cmd="${1:-bootstrap}"
case "$cmd" in
  bootstrap) do_bootstrap ;;
  build)     do_build ;;
  up)
    preflight
    compose --env-file "$ENV_FILE" up -d --force-recreate xinbo-oa
    verify
    ;;
  down)      preflight; compose --env-file "$ENV_FILE" down ;;
  restart)   preflight; compose --env-file "$ENV_FILE" restart xinbo-oa; verify ;;
  status)    preflight; compose --env-file "$ENV_FILE" ps xinbo-oa ;;
  logs)      preflight; compose --env-file "$ENV_FILE" logs -f --tail=200 xinbo-oa ;;
  verify)    preflight; verify ;;
  *)
    echo "用法: deploy.sh {bootstrap|up|down|restart|build|status|logs|verify}" >&2
    exit 2
    ;;
esac
