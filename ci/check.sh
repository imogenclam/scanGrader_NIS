#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"
mkdir -p test-results
git rev-parse HEAD | tee test-results/commit-sha.txt
python_bin=${PYTHON_BIN:-python3}

unformatted=$(gofmt -l src tests)
if [[ -n "$unformatted" ]]; then
  printf 'gofmt requires changes in:\n%s\n' "$unformatted" >&2
  exit 1
fi
go mod download
go mod verify
go vet ./...
go build -mod=readonly ./...
"$python_bin" -m py_compile tests/demo_api.py tests/scan_experiment.py
go test -mod=readonly -count=1 -json '-coverpkg=./...' -coverprofile=test-results/coverage.out ./... | tee test-results/go.jsonl
go tool cover -func=test-results/coverage.out | tee test-results/coverage.txt

# Ограничиваем проверку текущим коммитом и его предками.
scanner='ghcr.io/gitleaks/gitleaks:v8.24.2@sha256:b5918eb91b8d2473cec722f066abb4352e4ffdc4ec9f4283ec143aba9ec9ebc4'
MSYS2_ARG_CONV_EXCL='*' docker run --rm --network none \
  --mount "type=bind,source=$repo_root,target=/repo,readonly" \
  -e GIT_CONFIG_COUNT=1 -e GIT_CONFIG_KEY_0=safe.directory -e GIT_CONFIG_VALUE_0=/repo \
  "$scanner" git /repo --log-opts=HEAD --redact --no-banner 2>&1 | tee test-results/secrets.txt

# Каждый прогон получает собственные том, образ и свободный порт на loopback.
export COMPOSE_PROJECT_NAME="scangrader-ci-$(date +%s)-$$"
export SG_PORT=0
ocr_image="$COMPOSE_PROJECT_NAME-ocr"
cleanup() {
  docker compose down --volumes --rmi local >/dev/null 2>&1 || true
  docker image rm "$ocr_image" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker compose config --quiet
docker compose up --build -d --wait 2>&1 | tee test-results/build.txt
"$python_bin" tests/demo_api.py --result-file test-results/approved.json | tee test-results/http.txt
docker compose restart app
docker compose up --no-build -d --wait
"$python_bin" tests/demo_api.py --expect-approved --result-file test-results/after-restart.json | tee test-results/after-restart.txt
cmp test-results/approved.json test-results/after-restart.json

docker build -f tests/experiment.Dockerfile -t "$ocr_image" .
docker run --rm --network none "$ocr_image" | tee test-results/ocr.txt
