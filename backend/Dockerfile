# 多阶段构建：Go 编译在镜像内完成，宿主机不需要安装 Go。
# 构建：docker build -t xinbo-oa:local ./backend
# 如需换源：docker build --build-arg GOPROXY=https://goproxy.cn,direct ...
FROM golang:1.21-alpine AS builder

RUN apk add --no-cache git ca-certificates
ARG GOPROXY=https://goproxy.cn,direct
ENV CGO_ENABLED=0 GOOS=linux GOARCH=amd64
WORKDIR /src

COPY go.mod go.sum ./
RUN GOPROXY="$GOPROXY" go mod download

COPY cmd/ ./cmd/
COPY internal/ ./internal/
RUN GOPROXY="$GOPROXY" go build -trimpath -o /out/oa-api ./cmd/oa-api

FROM alpine:3.19
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY --from=builder /out/oa-api /app/oa-api
EXPOSE 10010
ENTRYPOINT ["/app/oa-api"]
