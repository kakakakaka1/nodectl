FROM alpine:3.20

RUN apk --no-cache add ca-certificates tzdata && \
    rm -rf /var/cache/apk/*

WORKDIR /app

ARG TARGETARCH

COPY --chmod=755 ./bin/nodectl-linux-${TARGETARCH} /app/nodectl

VOLUME ["/app/data"]

EXPOSE 8080

ENTRYPOINT ["/app/nodectl"]