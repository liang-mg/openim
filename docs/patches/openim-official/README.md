# 官方 IM 底座二开补丁（存档）

本目录保存团队对 **OpenIM 官方底座**的本地改动，仅作存档保底，不参与 OA 系统的构建与部署。

## 背景

OA 系统基于 OpenIM 官方底座运行，官方组件（mongo / redis / chat / openim-server / minio 等）通过**拉官方镜像**启动，源码不在本仓库。团队曾在本地源码副本上做过少量二开，这些改动不在协作仓的交付链路里，故存档于此，防止丢失。

原始位置（本机工作副本，`src/` 退役后仅供参考）：

- `src/open-im-server/` → `open-im-server/`、`open-im-server.patch`
- `src/chat/` → `chat/`、`chat.patch`

## 改动清单

| 仓库 | 文件 | 改动内容 | 行数 |
|---|---|---|---|
| open-im-server | `internal/rpc/msg/revoke.go` | 消息撤回逻辑 | +15 |
| open-im-server | `pkg/common/servererrs/code.go` / `predefine.go` | 新增错误码 | +2 |
| open-im-server | `Dockerfile` | 构建调整 | +4 |
| chat | `internal/api/chat/start.go` | 启动配置 | +1/-1 |
| chat | `Dockerfile` | 构建调整 | +4 |

## 文件说明

- `open-im-server.patch` / `chat.patch`：相对官方仓库 HEAD 的 unified diff（在各自官方仓库根目录执行 `git apply` 可还原改动）
- `open-im-server/` / `chat/`：改动后的**完整文件**，按官方仓库的相对路径存放，便于查看或手动替换

## 如何使用

当前 OA 底座使用官方镜像，**这些补丁没有启用**。若将来要把某个改动做进自建镜像：

1. clone 对应官方仓库（`github.com/openimsdk/open-im-server` 或 `github.com/openimsdk/chat`），切到与镜像一致的版本 tag
2. 在仓库根目录执行 `git apply <本目录>/xxx.patch`，或按路径手动覆盖完整文件
3. 自行构建镜像并在 compose 中替换官方镜像

> 注意：补丁基于当时的官方版本生成，升级官方版本后可能需要手工调整冲突，不要盲目 apply。
