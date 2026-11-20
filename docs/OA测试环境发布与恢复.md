# OA 测试环境发布与恢复

在 Linux 或 WSL 中运行以下命令。需要 Docker Compose、Git、curl、GNU coreutils 和 flock。先准备独立的 OpenIM 测试底座、OA 配置和测试账号。环境文件、TLS 私钥、发布状态和数据备份保存在仓库外。

## 固定版本与回滚

```bash
bash deploy/release.sh build <完整Git提交号> /srv/oa-test/releases/<提交号>
```

构建从指定提交导出 `backend/`、`frontend/` 和浏览器构建配方，记录基础镜像摘要和两个成品镜像 ID。更早的提交缺少浏览器构建配方时，使用脚本目录中的配方并记录其校验和。发布包包含 `images.tar.gz`、`release`、`base-images.lock`、`Dockerfile.oa-web` 和 `SHA256SUMS`。迁移环境时复制整个发布包。重新构建使用相同配方，并可将原发布包的 `base-images.lock` 作为最后一个参数。上线与回滚复用原归档，按校验和及镜像 ID 核对。重新构建可能受基础镜像包仓库更新影响。

```bash
export OA_RELEASE_PROJECT=<隔离测试底座的Compose项目名>
export OA_RELEASE_ENV=/srv/oa-test/private/oa.env
export OA_RELEASE_STATE=/srv/oa-test/release-state
export OA_RELEASE_WEB_URL=https://oa-test.example.com
bash deploy/release.sh apply /srv/oa-test/releases/<上一版提交号>
bash deploy/release.sh apply /srv/oa-test/releases/<当前提交号>
bash deploy/release.sh rollback
```

脚本只切换 `xinbo-oa`、`oa-web` 两个容器。沿用目标的 Compose 配置，必要时用 `OA_RELEASE_BASE` 和 `OA_RELEASE_COMPOSE` 指向目标文件。首次执行需要选用尚未运行这两个 OA 服务的测试项目。若首次启动未通过检查，脚本会停止候选 OA 服务，保留数据卷。每次成功切换记录 Git 提交和 Compose 配置 SHA-256；环境变量原值留在环境文件内。保留上一版完整发布包和独立备份。切换检查包括 `/work`、`/checkin`、`/report`、`/report-review`、`/oa-admin` 的刷新、入口 JS 和同源健康接口。浏览器验收还需用对应角色登录逐页检查，并用 Compose 查看两个 OA 服务的错误日志。

如果目标确认仍用旧静态目录，从同一发布包加载 `xinbo-oa-web:<提交号>`，用 `docker create` 和 `docker cp` 把容器内 `/usr/share/nginx/html/.` 复制到新的版本目录。现有 Nginx 的 SPA 回退和 `/oa/` 反代应继续指向该环境。先确认旧站点的实际目录和 Nginx 配置，再切换指向新版本目录的符号链接并 reload。回滚时恢复上一版链接及后端镜像。静态路径须位于现有 Web 根目录之下，保留上一版文件。

## 每日备份与隔离恢复

为备份任务设定下列环境变量。MongoDB 使用能读取 OA 集合的账号，MinIO 使用能读取 OA 专用桶的账号。URL 内带有特殊字符的凭据先做 URL 编码。

| 变量 | 示例 |
| --- | --- |
| `OA_DATA_NETWORK` | `oa-test_openim` |
| `OA_DATA_MONGO_URI` | `mongodb://mongo:27017`（隔离容器示例） |
| `OA_DATA_DB` | `oa_test_source` |
| `OA_DATA_MINIO_URL` | `http://<access-key>:<secret-key>@minio:9000` |
| `OA_DATA_BUCKET` | `oa-test-source` |

每天低峰运行 `bash /path/to/repo/deploy/data-tools.sh backup /srv/oa-test/backups`。在 Linux 的 cron 中可设为 `15 2 * * *`，由权限为 `0600` 的私有启动脚本加载环境变量。快照包含所有 `oa_*` 集合和 OA 专用桶对象。成功后只清理该目录里超过 7 天的本脚本快照。MongoDB 与 MinIO 分别备份，对严格一致性有要求的演练应在 OA 停止写入后执行。

恢复前启动独立 MongoDB 与 MinIO，换用该环境的网络、URI 和凭据。设置 `OA_DATA_ENV=test`，目标使用空 `oa_test_*` 数据库和未创建的 `oa-test-*` 桶，执行 `bash deploy/data-tools.sh restore /srv/oa-test/backups/oa-<时间戳>`。脚本校验快照并保留对象键，因此 OA 文件引用仍可解析。恢复后使用隔离 API 或数据库核对员工、打卡、日报、请假、`oa_file` 和相应对象。恢复中断后使用新的空目标重新执行。

测试数据只有带明确 `oa_test_marker` 的文档才纳入清理。先执行 `bash deploy/data-tools.sh cleanup-preview <公司ID> <标记>`，核对集合、公司、标记、文档 ID，再使用 `OA_DATA_CONFIRM=<公司ID>/<标记> bash deploy/data-tools.sh cleanup-apply <公司ID> <标记>`。清理限 `oa_test_*` 数据库，在每次删除时重新校对公司、标记与 ID。文件元数据及对象随隔离测试环境一起处置，避免移除其他记录引用的附件。

演示员工默认关闭。测试 Compose 叠加 `deploy/docker-compose.oa.test.yaml` 并设置 `OA_TEST_SEED_EMPLOYEES=true` 才会启用；直接运行 API 则同时设置 `OA_ENVIRONMENT=test` 和 `OA_SEED_EMPLOYEES=true`。该公司无任何员工档案时才写入四个预置账号，标记为 `demo-employees-v1`。

## TLS、续期与验收

测试域名指向测试网关，证书的 SAN 覆盖该域名。将证书链和私钥置于同一私有目录，分别命名为 `fullchain.pem` 和 `privkey.pem`。准备以下变量并在已有测试 Compose 上叠加网关。

```bash
export OA_TLS_DOMAIN=oa-test.example.com
export OA_TLS_REDIRECT_ORIGIN=https://oa-test.example.com
export OA_TLS_CERT_DIR=/srv/oa-test/private/tls
export OA_TLS_HTTP_PORT=80 OA_TLS_HTTPS_PORT=443
export OA_TLS_BIND=<测试网关绑定地址>
docker compose --project-name "$OA_RELEASE_PROJECT" --env-file "$OA_RELEASE_ENV" \
  -f base/docker-compose.yaml -f deploy/docker-compose.oa.yaml \
  -f deploy/docker-compose.oa.tls.yaml up -d --no-deps oa-tls
```

本机演练可使用 `127.0.0.1:8080` 和 `127.0.0.1:8443` 的默认映射，此时 `OA_TLS_REDIRECT_ORIGIN` 包含 `:8443`。若使用本地 CA，在 CLI 设置 `CURL_CA_BUNDLE` 为 CA 证书，并使用信任该 CA 的测试浏览器。CA 应与证书域名匹配。测试 HTTP 308 跳转、HTTPS 证书校验、同源 API、静态资源和 WebSocket，再在同一站点允许相机及定位，实际拍摄并提交打卡。

续期时把新证书链和私钥部署到挂载目录，保留前一组文件。用同一 Compose 参数执行 `exec -T oa-tls nginx -t`，通过后执行 `exec -T oa-tls nginx -s reload` 并复查。续期需要回退时恢复前一组证书文件，重新执行配置校验和 reload。测试网关整体需要回退时，执行 `stop oa-tls`，恢复该环境之前的 TLS 入口。
