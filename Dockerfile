# --- Build stage ---
FROM golang:1.26-alpine AS builder

RUN apk add --no-cache git

WORKDIR /src/server

# Cache dependencies
COPY server/go.mod server/go.sum ./
RUN go mod download

# Copy server source
COPY server/ ./

# Build binaries
ARG VERSION=dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /out/server ./cmd/server
RUN CGO_ENABLED=0 go build -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" -o /out/multica ./cmd/multica
RUN CGO_ENABLED=0 go build -ldflags "-s -w" -o /out/migrate ./cmd/migrate

# --- Runtime stage ---
FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata wget
RUN addgroup -S multica && adduser -S -G multica -h /app multica

WORKDIR /app

COPY --from=builder /out/server /app/server
COPY --from=builder /out/multica /app/multica
COPY --from=builder /out/migrate /app/migrate
COPY --chown=multica:multica server/migrations/ /app/migrations/

USER multica

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

ENTRYPOINT ["./server"]
