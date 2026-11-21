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
BASE_DIR="$OA_DIR/base"                             # 仓库自带的官方底座（compose + config）
COMPOSE_OA="$OA_DIR/deploy/docker-compose.oa.yaml"
COMPOSE_BRAND="$OA_DIR/deploy/docker-compose.brand.yaml"   # 管理后台「新博」品牌覆盖
ENV_FILE="${OA_ENV:-$OA_DIR/.env}"
ENV_TEMPLATE="$OA_DIR/config-template/oa.env.example"

ok()   { printf '  [OK] %s\n' "$*"; }
warn() { printf '[WARN] %s\n' "$*"; }
fail() { printf '[FAIL] %s\n' "$*" >&2; exit 1; }
step() { printf '\n==> %s\n' "$*"; }

# 探测底座 compose：优先用仓库自带的 base/，同事无需再 clone 官方底座
detect_compose() {
  if [ -n "${OA_COMPOSE:-}" ]; then echo "$OA_COMPOSE"; return; fi
  for c in "$BASE_DIR/docker-compose.yaml" "$BASE_DIR/docker-compose.yml"; do
    [ -f "$c" ] && { echo "$c"; return; }
  done
  fail "未找到底座 compose（$BASE_DIR/docker-compose.yaml），检查仓库是否完整。"
}

# compose 统一入口：官方底座 + OA override + 管理后台品牌 override
# 相对路径以第一个 -f（base/）为基准，品牌编排里的 ../frontend-custom 即仓库根。
compose() {
  local base; base="$(detect_compose)"
  docker compose -f "$base" -f "$COMPOSE_OA" -f "$COMPOSE_BRAND" "$@"
}

preflight() {
  step "环境预检"
  command -v docker >/dev/null 2>&1 || fail "缺少 docker，请先安装 Docker / Docker Desktop。"
  docker info >/dev/null 2>&1 || fail "Docker 未运行，请先启动 Docker。"
  # Go 编译已内置到 Dockerfile 多阶段构建，宿主机无需安装 Go
  [ -f "$COMPOSE_OA" ] || fail "缺少 $COMPOSE_OA，检查仓库是否完整。"
  [ -f "$COMPOSE_BRAND" ] || fail "缺少 $COMPOSE_BRAND，检查仓库是否完整。"
  [ -f "$OA_DIR/frontend-custom/admin/umi.8cd017f3.js" ] || fail "缺少管理后台品牌覆盖文件 frontend-custom/admin/，检查仓库是否完整。"
  [ -f "$ENV_TEMPLATE" ] || fail "缺少配置模板 $ENV_TEMPLATE。"
  [ -f "$(detect_compose)" ] || fail "底座 compose 不存在（$BASE_DIR）。"
  ok "docker / compose / 模板 / 后台品牌覆盖 均就绪（Go 编译在镜像内完成，无需本地安装）"
  ok "底座目录: $BASE_DIR"
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

# 构建后端镜像（Dockerfile 多阶段构建在镜像内完成 Go 编译，无需本地 Go）
build_backend_image() {
  step "构建 xinbo-oa:local 镜像（镜像内编译 Go 后端）"
  docker build \
    --build-arg "GOPROXY=${GOPROXY:-https://goproxy.cn,direct}" \
    -t xinbo-oa:local "$OA_DIR/backend" >/dev/null \
    || fail "后端镜像构建失败（检查网络/GOPROXY）。"
  ok "镜像 xinbo-oa:local 已就绪"
}

# 构建前端镜像（Node 构建 + nginx 全在镜像内，无需本地 Node/pnpm）
build_web_image() {
  step "构建 xinbo-oa-web:local 镜像（镜像内 pnpm install + vite build）"
  docker build -t xinbo-oa-web:local "$OA_DIR/frontend" >/dev/null \
    || fail "前端镜像构建失败（检查网络/npm registry）。"
  ok "镜像 xinbo-oa-web:local 已就绪"
}

build_all_images() {
  build_backend_image
  build_web_image
}

do_build() {
  preflight
  build_all_images
}

# 启动完整 IM 底座（依赖服务 + openim-server/chat）。
# 登录验证码与前端 /api /chat 反代都依赖这些容器；缺一步会导致页面反复重启。
ensure_im() {
  local base; base="$(detect_compose)"
  step "启动依赖底座（mongo / minio / redis / etcd / kafka）"
  docker compose -f "$base" --env-file "$ENV_FILE" up -d mongo minio redis etcd kafka \
    || fail "依赖底座启动失败，检查 $ENV_FILE 密码配置。"
  step "启动 IM 服务（openim-server / openim-chat）"
  # openim-server 官方镜像较大，首次拉取较慢；openim-chat 依赖其健康检查通过。
  docker compose -f "$base" --env-file "$ENV_FILE" up -d openim-server openim-chat \
    || fail "IM 服务启动失败，执行 docker logs openim-server 排查。"
  ok "IM 服务已提交启动（openim-server 有约 5 分钟观察期，chat 随后就绪）"
}

do_bootstrap() {
  step "OA 环境一键部署（首次全流程）"
  preflight
  prepare_env
  build_all_images

  ensure_im

  step "启动 OA 服务 + 前端 + 管理后台"
  compose --env-file "$ENV_FILE" up -d --force-recreate xinbo-oa oa-web openim-admin-front \
    || fail "OA 服务启动失败，执行 deploy.sh logs 查看日志。"

  verify
  echo ""
  echo "============================================================"
  ok "OA 环境已就绪"
  echo "  前端页面:   http://127.0.0.1:${XINBO_OA_WEB_PORT:-5173}"
  echo "  后端健康:   http://127.0.0.1:${XINBO_OA_PORT:-10010}/oa/api/v1/healthz"
  echo "  验证接口:   curl http://127.0.0.1:${XINBO_OA_WEB_PORT:-5173}/oa/api/v1/healthz"
  echo "  管理后台:   http://127.0.0.1:${OPENIM_ADMIN_FRONT_PORT:-11002}（新博品牌）"
  echo "  回归脚本:   node scripts/oa_e2e_check.js（需设 OA_TOKEN_SECRET/MONGO_PASSWORD）"
  echo "  登录验证码: 666666（需 IM 服务 openim-server/openim-chat 已启动）"
  echo "============================================================"
}

verify() {
  step "验收检查"
  local port; port="$(grep -E '^XINBO_OA_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '\r')"
  port="${port:-10010}"
  local web_port; web_port="$(grep -E '^XINBO_OA_WEB_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '\r')"
  web_port="${web_port:-5173}"
  local url="http://127.0.0.1:${port}/oa/api/v1/healthz"

  compose --env-file "$ENV_FILE" ps 2>/dev/null | grep -qE 'xinbo-oa|oa-web' \
    && ok "容器已创建" || warn "容器状态异常，执行 deploy.sh status"

  local backend_ok=0
  for i in $(seq 1 20); do
    if curl -fsS "$url" >/dev/null 2>&1; then ok "后端健康检查通过: $url"; backend_ok=1; break; fi
    sleep 2
  done
  [ "$backend_ok" -eq 1 ] || fail "后端健康检查失败（40 秒无响应）。执行 deploy.sh logs 排查。"

  # 前端：首页能返回 HTML，且同源 /oa 反代能通到后端
  local web_ok=0
  for i in $(seq 1 20); do
    if curl -fsS "http://127.0.0.1:${web_port}/" 2>/dev/null | grep -qi '<html'; then
      ok "前端首页可访问: http://127.0.0.1:${web_port}"
      web_ok=1; break
    fi
    sleep 2
  done
  [ "$web_ok" -eq 1 ] || warn "前端首页暂不可访问（构建较慢），执行 deploy.sh logs oa-web 查看。"
  if curl -fsS "http://127.0.0.1:${web_port}/oa/api/v1/healthz" >/dev/null 2>&1; then
    ok "前端 /oa 同源反代正常"
  else
    warn "前端 /oa 反代未通，检查 oa-web 与 xinbo-oa 是否同在 openim 网络。"
  fi

  # 管理后台：11002 首页可访问，且品牌覆盖生效（title 为新博）
  local admin_port; admin_port="$(grep -E '^OPENIM_ADMIN_FRONT_PORT=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '\r')"
  admin_port="${admin_port:-11002}"
  local admin_ok=0
  for i in $(seq 1 20); do
    local admin_html; admin_html="$(curl -fsS "http://127.0.0.1:${admin_port}/" 2>/dev/null)"
    if printf '%s' "$admin_html" | grep -qi '<html'; then
      ok "管理后台可访问: http://127.0.0.1:${admin_port}"
      if printf '%s' "$admin_html" | grep -q '<title>新博</title>'; then
        ok "管理后台品牌覆盖生效（title=新博）"
      else
        warn "管理后台品牌未生效，检查 frontend-custom/admin/ 挂载与 docker-compose.brand.yaml。"
      fi
      admin_ok=1; break
    fi
    sleep 2
  done
  [ "$admin_ok" -eq 1 ] || warn "管理后台暂不可访问（${admin_port}），执行 deploy.sh logs openim-admin-front 查看。"
}

cmd="${1:-bootstrap}"
case "$cmd" in
  bootstrap) do_bootstrap ;;
  build)     do_build ;;
  up)
    preflight
    ensure_im
    compose --env-file "$ENV_FILE" up -d --force-recreate xinbo-oa oa-web openim-admin-front
    verify
    ;;
  down)      preflight; compose --env-file "$ENV_FILE" down ;;
  restart)   preflight; ensure_im; compose --env-file "$ENV_FILE" restart xinbo-oa oa-web openim-admin-front; verify ;;
  status)    preflight; compose --env-file "$ENV_FILE" ps ;;
  logs)      preflight; compose --env-file "$ENV_FILE" logs -f --tail=200 "${2:-xinbo-oa}" ;;
  verify)    preflight; verify ;;
  *)
    echo "用法: deploy.sh {bootstrap|up|down|restart|build|status|logs|verify}" >&2
    exit 2
    ;;
esac
