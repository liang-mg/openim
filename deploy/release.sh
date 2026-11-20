#!/usr/bin/env bash
set -euo pipefail
umask 077

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
die() { printf '%s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法
  bash deploy/release.sh build FULL_COMMIT OUTPUT_DIR [BASE_IMAGES_LOCK]
  bash deploy/release.sh verify WEB_URL
  bash deploy/release.sh apply RELEASE_DIR
  bash deploy/release.sh rollback

apply / rollback 需要 OA_RELEASE_PROJECT、OA_RELEASE_ENV、OA_RELEASE_STATE、OA_RELEASE_WEB_URL。
OA_RELEASE_BASE 和 OA_RELEASE_COMPOSE 可覆盖本仓库的两份 Compose 配置路径。
EOF
}

lock_dockerfile() {
  local file=$1 lock=${2:-} line source_ref suffix pinned
  while IFS= read -r line || [[ -n $line ]]; do
    if [[ $line =~ ^FROM[[:blank:]]+([^[:blank:]]+)(.*)$ ]]; then
      source_ref=${BASH_REMATCH[1]}
      suffix=${BASH_REMATCH[2]}
      pinned=$(awk -v ref="$source_ref" '$1 == ref {print $2; exit}' "$build_dir/base-images.lock")
      if [[ -z $pinned && -n $lock ]]; then
        pinned=$(awk -v ref="$source_ref" '$1 == ref {print $2; exit}' "$lock")
      elif [[ -z $pinned ]]; then
        docker pull --platform linux/amd64 "$source_ref" >&2
        pinned=$(docker image inspect --format '{{index .RepoDigests 0}}' "$source_ref")
      fi
      [[ $pinned =~ ^[a-zA-Z0-9._/:-]+@sha256:[0-9a-f]{64}$ ]] || die "基础镜像缺少摘要 $source_ref"
      if ! grep -Fxq -- "$source_ref $pinned" "$build_dir/base-images.lock"; then
        printf '%s %s\n' "$source_ref" "$pinned" >> "$build_dir/base-images.lock"
      fi
      printf 'FROM %s%s\n' "$pinned" "$suffix"
    else
      printf '%s\n' "$line"
    fi
  done < "$file" > "$file.release"
}

build() {
  local commit=$1 output=$2 base_lock=${3:-} api_tag web_tag
  [[ $commit =~ ^[a-f0-9]{40}$ ]] || die "请指定完整 Git 提交号"
  [[ $(git -C "$repo" rev-parse --verify "$commit^{commit}") == "$commit" ]] || die "提交不存在"
  [[ -z $base_lock || -f $base_lock ]] || die "基础镜像锁文件不存在"
  [[ ! -e $output ]] || die "发布输出目录必须尚未存在"
  output=$(cd -- "$(dirname -- "$output")" && pwd)/$(basename -- "$output")
  build_dir=$(mktemp -d "$(dirname -- "$output")/.oa-build.XXXXXXXX")
  trap 'rm -rf -- "$build_dir"' EXIT
  mkdir "$build_dir/source" "$build_dir/artifacts"
  git -C "$repo" archive "$commit" backend frontend | tar -xf - -C "$build_dir/source"
  if git -C "$repo" cat-file -e "$commit:deploy/Dockerfile.oa-web" 2>/dev/null; then
    git -C "$repo" show "$commit:deploy/Dockerfile.oa-web" > "$build_dir/source/frontend/Dockerfile.oa-web"
  else
    printf '历史提交缺少发布配方，使用本次脚本配方并记录校验和。\n' >&2
    cp -- "$repo/deploy/Dockerfile.oa-web" "$build_dir/source/frontend/Dockerfile.oa-web"
  fi
  : > "$build_dir/base-images.lock"
  lock_dockerfile "$build_dir/source/backend/Dockerfile" "$base_lock"
  lock_dockerfile "$build_dir/source/frontend/Dockerfile.oa-web" "$base_lock"
  api_tag="xinbo-oa:$commit"
  web_tag="xinbo-oa-web:$commit"
  docker build --platform linux/amd64 --label "org.opencontainers.image.revision=$commit" \
    --build-arg "GOPROXY=${GOPROXY:-https://proxy.golang.org,direct}" \
    -t "$api_tag" -f "$build_dir/source/backend/Dockerfile.release" "$build_dir/source/backend"
  docker build --platform linux/amd64 --label "org.opencontainers.image.revision=$commit" \
    -t "$web_tag" -f "$build_dir/source/frontend/Dockerfile.oa-web.release" "$build_dir/source/frontend"
  docker save "$api_tag" "$web_tag" | gzip -n > "$build_dir/artifacts/images.tar.gz"
  printf '%s\n%s\n%s\n' "$commit" "$(image_id "$api_tag")" "$(image_id "$web_tag")" > "$build_dir/artifacts/release"
  cp -- "$build_dir/base-images.lock" "$build_dir/artifacts/base-images.lock"
  cp -- "$build_dir/source/frontend/Dockerfile.oa-web" "$build_dir/artifacts/Dockerfile.oa-web"
  (cd "$build_dir/artifacts" && sha256sum images.tar.gz release base-images.lock Dockerfile.oa-web > SHA256SUMS)
  mv -T -- "$build_dir/artifacts" "$output"
  printf '发布包已生成 %s\n' "$output"
}

image_id() { docker image inspect --format '{{.Id}}' "$1"; }

verify() {
  local url=${1%/} entry page asset mime
  local retry=(curl -fsS --retry 5 --retry-all-errors --retry-delay 1 --max-time 8)
  entry=$("${retry[@]}" "$url/") || return 1
  for route in work checkin report report-review oa-admin; do
    page=$("${retry[@]}" "$url/$route") || return 1
    if [[ $page != "$entry" ]]; then
      printf '深层路由未返回同一 SPA 入口 %s\n' "$route" >&2
      return 1
    fi
  done
  asset=$(sed -nE 's/.*src="(\/assets\/[^"]+\.js)".*/\1/p' <<< "$entry" | sed -n '1p')
  if [[ $asset != /assets/*.js ]]; then
    printf '入口 HTML 未引用构建后的 JS 资源\n' >&2
    return 1
  fi
  mime=$("${retry[@]}" "$url$asset" -o /dev/null -w '%{content_type}') || return 1
  case "$mime" in
    application/javascript*|text/javascript*) ;;
    *) printf 'JS 静态资源返回了意外的 Content-Type %s\n' "$mime" >&2; return 1 ;;
  esac
  "${retry[@]}" "$url/oa/api/v1/healthz" | grep -q '"status":"ok"' || return 1
  printf 'HTTP 复查通过，覆盖五条深层路由、JS 和 OA 同源健康接口\n'
}

compose() {
  docker compose --project-name "$OA_RELEASE_PROJECT" --env-file "$OA_RELEASE_ENV" \
    -f "${OA_RELEASE_BASE:-$repo/base/docker-compose.yaml}" \
    -f "${OA_RELEASE_COMPOSE:-$repo/deploy/docker-compose.oa.yaml}" "$@"
}

switch_release() {
  local directory=$1
  local -a release
  (cd "$directory" && sha256sum --quiet -c SHA256SUMS) || return 1
  mapfile -t release < "$directory/release" || return 1
  [[ ${#release[@]} == 3 && ${release[0]} =~ ^[0-9a-f]{40}$ &&
     ${release[1]} =~ ^sha256:[0-9a-f]{64}$ && ${release[2]} =~ ^sha256:[0-9a-f]{64}$ ]] || return 1
  export XINBO_OA_IMAGE="xinbo-oa:${release[0]}" XINBO_OA_WEB_IMAGE="xinbo-oa-web:${release[0]}"
  docker load -i "$directory/images.tar.gz" || return 1
  [[ $(image_id "$XINBO_OA_IMAGE") == "${release[1]}" &&
     $(image_id "$XINBO_OA_WEB_IMAGE") == "${release[2]}" ]] || return 1
  config_fingerprint=$(compose config | sha256sum) || return 1
  switch_attempted=true
  compose up -d --no-deps --no-build --pull never xinbo-oa oa-web || return 1
  [[ $(docker inspect --format '{{.Image}}' "$(compose ps -q xinbo-oa)") == "${release[1]}" &&
     $(docker inspect --format '{{.Image}}' "$(compose ps -q oa-web)") == "${release[2]}" ]] || return 1
  verify "$OA_RELEASE_WEB_URL" || return 1
  printf '%s %s %s\n' "$(date -u +%FT%TZ)" "${release[0]}" "${config_fingerprint%% *}" >> "$state/history" || return 1
  printf '已运行提交 %s，Compose 配置 SHA-256 %s\n' "${release[0]}" "${config_fingerprint%% *}"
}

apply_or_rollback() {
  local action=$1 directory current="" running="" switch_attempted=false
  [[ ${OA_RELEASE_PROJECT:-} =~ ^[a-z0-9][a-z0-9_-]*$ &&
     -f ${OA_RELEASE_ENV:-} && -n ${OA_RELEASE_STATE:-} &&
     ${OA_RELEASE_WEB_URL:-} =~ ^https?:// ]] || die "缺少可核查的 Compose 项目、环境文件、发布状态目录或验证 URL"
  mkdir -p -- "$OA_RELEASE_STATE"
  state=$(cd -- "$OA_RELEASE_STATE" && pwd)
  exec 9> "$state/.lock"
  flock -n 9 || die "已有发布正在执行"
  [[ ! -f $state/current ]] || IFS= read -r current < "$state/current"
  if [[ -z $current ]]; then
    running=$(compose ps --status running --status restarting --status paused -q xinbo-oa oa-web) ||
      die "无法确认项目中的 OA 容器状态"
    [[ -z $running ]] || die "项目已有运行中的 OA 容器，但没有受管版本记录。请使用独立测试项目初始化发布状态。"
  fi
  if [[ $action == rollback ]]; then
    [[ -s $state/previous ]] || die "没有已验证的上一版"
    IFS= read -r directory < "$state/previous"
  else
    directory=$(cd -- "$2" && pwd)
  fi
  [[ $directory != "$current" ]] || die "目标版本已在当前状态中"
  if ! switch_release "$directory"; then
    if [[ -n $current ]]; then
      printf '切换检查失败，正在恢复当前已验证版本\n' >&2
      switch_release "$current" || die "恢复失败，需用 Compose 检查两个 OA 服务"
    elif [[ $switch_attempted == true ]]; then
      compose stop xinbo-oa oa-web || die "停止未通过检查的 OA 容器失败"
    fi
    die "切换检查失败"
  fi
  if [[ -n $current ]]; then
    printf '%s\n' "$current" > "$state/.previous.tmp"
    mv -T -- "$state/.previous.tmp" "$state/previous"
  fi
  printf '%s\n' "$directory" > "$state/.current.tmp"
  mv -T -- "$state/.current.tmp" "$state/current"
}

case "${1:-}" in
  build) [[ $# == 3 || $# == 4 ]] || { usage; exit 2; }; build "${@:2}" ;;
  verify) [[ $# == 2 ]] || { usage; exit 2; }; verify "$2" ;;
  apply) [[ $# == 2 ]] || { usage; exit 2; }; apply_or_rollback "$@" ;;
  rollback) [[ $# == 1 ]] || { usage; exit 2; }; apply_or_rollback "$@" ;;
  -h|--help|"") usage ;;
  *) usage; exit 2 ;;
esac
