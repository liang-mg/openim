#!/usr/bin/env bash
set -euo pipefail
umask 077

die() { printf '%s\n' "$*" >&2; exit 1; }

usage() {
  cat <<'EOF'
用法
  bash deploy/data-tools.sh backup BACKUP_ROOT
  bash deploy/data-tools.sh restore SNAPSHOT_DIR
  bash deploy/data-tools.sh cleanup-preview COMPANY MARKER
  OA_DATA_CONFIRM=COMPANY/MARKER bash deploy/data-tools.sh cleanup-apply COMPANY MARKER

设置 OA_DATA_NETWORK、OA_DATA_MONGO_URI、OA_DATA_DB。
备份和恢复还需 OA_DATA_MINIO_URL、OA_DATA_BUCKET。
恢复和清理仅在 OA_DATA_ENV=test、oa_test_* 数据库执行，恢复对象桶必须以 oa-test- 开头。
EOF
}

action=${1:-}
case "$action" in
  backup|restore) [[ $# == 2 ]] || { usage; exit 2; } ;;
  cleanup-preview|cleanup-apply) [[ $# == 3 ]] || { usage; exit 2; } ;;
  -h|--help|"") usage; exit 0 ;;
  *) usage; exit 2 ;;
esac

: "${OA_DATA_NETWORK:?请指定隔离或目标 Docker 网络}"
: "${OA_DATA_MONGO_URI:?请指定 MongoDB URI}"
: "${OA_DATA_DB:?请指定 MongoDB 数据库名称}"
[[ $OA_DATA_DB =~ ^[a-zA-Z0-9_]+$ ]] || die "数据库名仅支持字母、数字、下划线"
export OA_DATA_MONGO_URI OA_DATA_DB

if [[ $action != backup ]]; then
  [[ ${OA_DATA_ENV:-} == test && $OA_DATA_DB == oa_test_* ]] ||
    die "只能在明确指定的测试环境 oa_test_* 数据库执行"
fi

mongo() {
  docker run --rm --network "$OA_DATA_NETWORK" \
    -e OA_DATA_MONGO_URI -e OA_DATA_DB "$@" mongo:7.0.28 \
    sh -ec 'exec mongosh --quiet --norc "$OA_DATA_MONGO_URI" --eval "$1"' sh "$mongo_script"
}

if [[ $action == cleanup-* ]]; then
  [[ $2 =~ ^[a-zA-Z0-9_-]+$ && $3 =~ ^[a-zA-Z0-9_-]+$ ]] || die "公司和测试标记仅支持字母、数字、下划线、横线"
  export OA_CLEANUP_COMPANY=$2 OA_CLEANUP_MARKER=$3 OA_CLEANUP_ACTION=$action
  [[ $action == cleanup-preview || ${OA_DATA_CONFIRM:-} == "$2/$3" ]] ||
    die "先执行 cleanup-preview，再用 OA_DATA_CONFIRM=公司/标记 确认"

  # oa_file 与已上传对象保留，附件可能仍由其他未标记的记录引用。
  mongo_script='
    const target = db.getSiblingDB(process.env.OA_DATA_DB);
    const company = process.env.OA_CLEANUP_COMPANY;
    const marker = process.env.OA_CLEANUP_MARKER;
    const filter = {
      company_id: company, oa_test_marker: marker,
      $expr: {$and: [{$eq: ["$company_id", company]}, {$eq: ["$oa_test_marker", marker]}]},
    };
    const apply = process.env.OA_CLEANUP_ACTION === "cleanup-apply";
    for (const name of target.getCollectionNames().filter(n => /^oa_[a-z0-9_]+$/.test(n) && n !== "oa_file").sort()) {
      const collection = target.getCollection(name);
      const ids = collection.find(filter, {_id: 1}).toArray().map(row => row._id);
      if (!ids.length) continue;
      print(EJSON.stringify({collection: name, company: filter.company_id, marker: filter.oa_test_marker, ids}));
      if (apply) print(EJSON.stringify({collection: name, deleted: collection.deleteMany({...filter, _id: {$in: ids}}).deletedCount}));
    }
  '
  mongo -e OA_CLEANUP_COMPANY -e OA_CLEANUP_MARKER -e OA_CLEANUP_ACTION
  exit
fi

: "${OA_DATA_MINIO_URL:?请指定 MinIO URL（包含备份/恢复专用凭据）}"
: "${OA_DATA_BUCKET:?请指定 OA 专用桶}"
[[ $OA_DATA_BUCKET =~ ^[a-z0-9][a-z0-9.-]+$ ]] || die "MinIO 桶名无效"
export MC_HOST_oa=$OA_DATA_MINIO_URL

object_store() {
  local directory=$1
  shift
  docker run --rm --network "$OA_DATA_NETWORK" --user "$(id -u):$(id -g)" \
    -e MC_HOST_oa -e MC_CONFIG_DIR=/tmp/mc -v "$directory:/data" \
    --entrypoint mc minio/minio:RELEASE.2025-04-22T22-12-26Z "$@"
}

if [[ $action == backup ]]; then
  mkdir -p -- "$2"
  root=$(cd -- "$2" && pwd)
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  snapshot="$root/oa-$stamp"
  [[ ! -e $snapshot ]] || die "该时间点的快照已存在"
  stage=$(mktemp -d "$root/.partial.XXXXXXXX")
  trap 'rm -rf -- "$stage"' EXIT
  mkdir "$stage/mongo" "$stage/minio"

  mongo_script='for (const name of db.getSiblingDB(process.env.OA_DATA_DB).getCollectionNames().sort()) if (/^oa_[a-z0-9_]+$/.test(name)) print(name)'
  collections=$(mongo)
  [[ -n $collections ]] || die "目标数据库没有 OA 集合"
  while IFS= read -r collection; do
    [[ $collection =~ ^oa_[a-z0-9_]+$ ]] || die "MongoDB 返回未知集合名"
    docker run --rm --network "$OA_DATA_NETWORK" \
      -e OA_DATA_MONGO_URI -e OA_DATA_DB -e "OA_DATA_COLLECTION=$collection" mongo:7.0.28 \
      sh -ec 'exec mongodump --uri "$OA_DATA_MONGO_URI" --db "$OA_DATA_DB" --collection "$OA_DATA_COLLECTION" --archive --gzip' \
      > "$stage/mongo/$collection.archive.gz"
  done <<< "$collections"
  object_store "$stage" mirror --preserve "oa/$OA_DATA_BUCKET/" /data/minio/
  printf '%s\n%s\n' "$OA_DATA_DB" "$OA_DATA_BUCKET" > "$stage/source"
  (
    cd "$stage"
    find source mongo minio -type f -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS
  )
  mv -T -- "$stage" "$snapshot"
  trap - EXIT
  printf '快照已保存 %s\n' "$snapshot"

  while IFS= read -r -d '' previous; do
    if [[ ${previous##*/} =~ ^oa-[0-9]{8}T[0-9]{6}Z$ && -f $previous/SHA256SUMS ]]; then
      rm -rf -- "$previous"
    fi
  done < <(find "$root" -mindepth 1 -maxdepth 1 -type d -mmin +10079 -print0)
  exit
fi

[[ $OA_DATA_BUCKET == oa-test-* ]] || die "恢复桶必须以 oa-test- 开头"
snapshot=$(cd -- "$2" && pwd)
(cd "$snapshot" && sha256sum --quiet -c SHA256SUMS)
IFS= read -r source_db < "$snapshot/source"
[[ $source_db =~ ^[a-zA-Z0-9_]+$ ]] || die "快照源数据库名无效"
shopt -s nullglob
archives=("$snapshot"/mongo/oa_*.archive.gz)
(( ${#archives[@]} > 0 )) || die "快照没有 OA 集合数据"
mongo_script='print(db.getSiblingDB(process.env.OA_DATA_DB).getCollectionNames().length)'
[[ $(mongo) == 0 ]] || die "恢复目标数据库必须为空"

# 必须新建桶，重复使用已有桶时在任何恢复写入前停止。
object_store "$snapshot" mb "oa/$OA_DATA_BUCKET"
for archive in "${archives[@]}"; do
  collection=${archive##*/}
  collection=${collection%.archive.gz}
  [[ $collection =~ ^oa_[a-z0-9_]+$ ]] || die "快照集合名无效"
  docker run --rm -i --network "$OA_DATA_NETWORK" \
    -e OA_DATA_MONGO_URI \
    -e "OA_DATA_FROM=$source_db.$collection" -e "OA_DATA_TO=$OA_DATA_DB.$collection" mongo:7.0.28 \
    sh -ec 'exec mongorestore --uri "$OA_DATA_MONGO_URI" --archive --gzip --stopOnError --nsFrom "$OA_DATA_FROM" --nsTo "$OA_DATA_TO"' \
    < "$archive"
done
object_store "$snapshot" mirror --preserve /data/minio/ "oa/$OA_DATA_BUCKET/"
printf '已恢复到测试数据库 %s 和桶 %s\n' "$OA_DATA_DB" "$OA_DATA_BUCKET"
