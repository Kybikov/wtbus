FROM golang:1.26-alpine AS builder

ARG COMMAND=api

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/vivat-${COMMAND} ./cmd/${COMMAND}

FROM alpine:3.22

ARG COMMAND=api

RUN addgroup -S app && adduser -S app -G app
RUN apk add --no-cache ca-certificates

USER app
COPY --from=builder /out/vivat-${COMMAND} /vivat

EXPOSE 8080

ENTRYPOINT ["/vivat"]
