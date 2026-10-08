FROM golang:1.26-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY . .
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/vivat-api ./cmd/api \
 && CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/vivat-bot ./cmd/bot

FROM alpine:3.22

RUN addgroup -S app && adduser -S app -G app \
 && apk add --no-cache ca-certificates

COPY --from=builder /out/vivat-api /vivat-api
COPY --from=builder /out/vivat-bot /vivat-bot

USER app

EXPOSE 8080

ENTRYPOINT ["/vivat-api"]
