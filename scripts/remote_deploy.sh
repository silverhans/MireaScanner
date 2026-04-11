#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HOST="${QRS_HOST:?QRS_HOST is required (e.g. QRS_HOST=1.2.3.4)}"
USER="${QRS_USER:-root}"
APP_DIR="${QRS_APP_DIR:-/opt/qrscaner}"
SERVICE="${QRS_SERVICE:-qrscaner}"

BUILD_WEBAPP=1
RUN_EXTERNAL_SMOKE=0
RUN_CANARY=0

CANARY_PATH="${QRS_CANARY_PATH:-/api/health}"
CANARY_DURATION_S="${QRS_CANARY_DURATION_S:-20}"
CANARY_CONCURRENCY="${QRS_CANARY_CONCURRENCY:-16}"
CANARY_TIMEOUT_S="${QRS_CANARY_TIMEOUT_S:-3}"
CANARY_MIN_SUCCESS_RATE="${QRS_CANARY_MIN_SUCCESS_RATE:-0.99}"
CANARY_MAX_5XX="${QRS_CANARY_MAX_5XX:-0}"
CANARY_MAX_P95_MS="${QRS_CANARY_MAX_P95_MS:-250}"

while [[ $# -gt 0 ]]; do
  case "${1}" in
    --skip-webapp)
      BUILD_WEBAPP=0
      ;;
    --external-smoke)
      RUN_EXTERNAL_SMOKE=1
      ;;
    --canary)
      RUN_CANARY=1
      ;;
    *)
      echo "Unknown option: ${1}" >&2
      echo "Usage: $0 [--skip-webapp] [--external-smoke] [--canary]" >&2
      exit 2
      ;;
  esac
  shift
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REMOTE="${USER}@${HOST}"
LOCAL_SHA="$(git -C "${ROOT_DIR}" rev-parse --short=12 HEAD 2>/dev/null || echo unknown)"
LOCAL_BRANCH="$(git -C "${ROOT_DIR}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo unknown)"
LOCAL_VERSION="$(git -C "${ROOT_DIR}" describe --tags --always 2>/dev/null || echo "${LOCAL_SHA}")"
DEPLOYED_AT_UTC="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "[1/6] Remote backup: ${APP_DIR}/releases/qrscaner-${STAMP}.tgz"
ssh "${REMOTE}" "mkdir -p '${APP_DIR}/releases' && cd '${APP_DIR}' && tar -czf 'releases/qrscaner-${STAMP}.tgz' --exclude='./releases' --exclude='./data' --exclude='./.env' --exclude='./venv' --exclude='./.git' --exclude='./webapp/node_modules' --exclude='./attendance_core/target' ."

echo "[2/6] Rsync code to ${REMOTE}:${APP_DIR}"
rsync -az --delete \
  --exclude '.git/' \
  --exclude 'data/' \
  --exclude 'releases/' \
  --exclude '.env' \
  --exclude 'venv/' \
  --exclude 'webapp/node_modules/' \
  --exclude 'webapp/dist/' \
  --exclude 'attendance_core/target/' \
  --exclude '**/__pycache__/' \
  "${ROOT_DIR}/" "${REMOTE}:${APP_DIR}/"

echo "[2a/6] DB backup (rotated)"
ssh "${REMOTE}" "cd '${APP_DIR}' && mkdir -p '${APP_DIR}/releases/db-backups' && ./venv/bin/python scripts/backup_db.py --out-dir '${APP_DIR}/releases/db-backups' --keep 14 --gzip"

echo "[2b/6] DB migrations"
ssh "${REMOTE}" "cd '${APP_DIR}' && ./venv/bin/python scripts/db_migrate.py --apply"

echo "[2c/6] Write build metadata"
tmp_build_info="$(mktemp)"
cat > "${tmp_build_info}" <<EOF
{
  "version": "${LOCAL_VERSION}",
  "git_sha": "${LOCAL_SHA}",
  "branch": "${LOCAL_BRANCH}",
  "deployed_at_utc": "${DEPLOYED_AT_UTC}"
}
EOF
scp "${tmp_build_info}" "${REMOTE}:${APP_DIR}/build_info.json" >/dev/null
rm -f "${tmp_build_info}"

if [[ "${BUILD_WEBAPP}" == "1" ]]; then
  echo "[3/6] Build webapp on server"
  ssh "${REMOTE}" "cd '${APP_DIR}/webapp' && npm install && npm run build"
else
  echo "[3/6] Skip webapp build"
fi

echo "[4/6] Build attendance_core on server (optional)"
ssh "${REMOTE}" "if command -v cargo >/dev/null 2>&1 && [ -f '${APP_DIR}/attendance_core/Cargo.toml' ]; then cd '${APP_DIR}/attendance_core' && (cargo build --release || (rm -f Cargo.lock && cargo generate-lockfile && cargo build --release)) || echo 'attendance_core build failed'; else echo 'Skip attendance_core build'; fi" || true

echo "[5/6] Restart service: ${SERVICE}"
ssh "${REMOTE}" "
  systemctl restart '${SERVICE}' && systemctl is-active '${SERVICE}'
  # Restart API workers if they exist
  for svc in qrscaner-api@8081 qrscaner-api@8082; do
    if systemctl list-unit-files \"\${svc}.service\" 2>/dev/null | grep -q enabled; then
      systemctl restart \"\${svc}\" && echo \"Restarted \${svc}\"
    fi
  done
"

echo "Health check"
ssh "${REMOTE}" "set -e; for i in \$(seq 1 25); do if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then echo OK; exit 0; fi; sleep 1; done; echo 'Health check failed' >&2; exit 1"

echo "Smoke tests"
if [[ "${RUN_EXTERNAL_SMOKE}" == "1" ]]; then
  echo "[6/6] Smoke tests (with external schedule checks)"
  ssh "${REMOTE}" "cd '${APP_DIR}' && ./venv/bin/python scripts/smoke_test.py --base-url http://127.0.0.1:8080 --external"
else
  echo "[6/6] Smoke tests"
  ssh "${REMOTE}" "cd '${APP_DIR}' && ./venv/bin/python scripts/smoke_test.py --base-url http://127.0.0.1:8080"
fi

if [[ "${RUN_CANARY}" == "1" ]]; then
  echo "[7/7] Canary load test"
  ssh "${REMOTE}" "cd '${APP_DIR}' && ./venv/bin/python scripts/canary_load.py --base-url http://127.0.0.1:8080 --path '${CANARY_PATH}' --duration-s '${CANARY_DURATION_S}' --concurrency '${CANARY_CONCURRENCY}' --timeout-s '${CANARY_TIMEOUT_S}' --min-success-rate '${CANARY_MIN_SUCCESS_RATE}' --max-5xx '${CANARY_MAX_5XX}' --max-p95-ms '${CANARY_MAX_P95_MS}'"
else
  echo "[7/7] Canary load test skipped (use --canary)"
fi
