FROM node:24-bookworm-slim AS frontend
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci --no-audit --no-fund
COPY web/ ./
RUN npm test && npm run build

FROM golang:1.26.11-bookworm AS backend
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY web/assets.go ./web/
COPY --from=frontend /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -trimpath -o /out/scangrader ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates ghostscript && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 --create-home scangrader && install -d -o scangrader -g scangrader /data
COPY --from=backend /out/scangrader /usr/local/bin/scangrader
USER scangrader
ENV SG_ADDR=:8080 SG_DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["scangrader"]
