FROM golang:1.26.11-bookworm@sha256:4ebd099cae89439fff17af404a9c724079d439b4d92178819318735312ee9eb3 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY src/ ./src/
RUN CGO_ENABLED=0 go build -mod=readonly -trimpath -o /out/scangrader ./src/cmd/scangrader

FROM alpine:3.23@sha256:469c9ea410b9215eaee7976ba6c0639039b444be8e5d638f7abbada189971eb2
RUN mkdir /data && chown 10001:10001 /data && chmod 0700 /data
COPY --from=build /out/scangrader /usr/local/bin/scangrader
USER 10001:10001
ENV SG_ADDR=:8080 SG_DATA_DIR=/data
EXPOSE 8080
HEALTHCHECK --interval=3s --timeout=2s --start-period=3s --retries=10 CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/healthz"]
ENTRYPOINT ["scangrader"]
