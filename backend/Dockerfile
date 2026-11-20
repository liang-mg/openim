FROM alpine:3.19
RUN apk add --no-cache tzdata ca-certificates
ENV TZ=Asia/Shanghai
WORKDIR /app
COPY bin/oa-api /app/oa-api
EXPOSE 10010
ENTRYPOINT ["/app/oa-api"]
