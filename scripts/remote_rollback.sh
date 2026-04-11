#!/usr/bin/env bash
set -euo pipefail

HOST="${QRS_HOST:?QRS_HOST is required (e.g. QRS_HOST=1.2.3.4)}"
USER="${QRS_USER:-root}"
APP_DIR="${QRS_APP_DIR:-/opt/qrscaner}"
SERVICE="${QRS_SERVICE:-qrscaner}"

REMOTE="${USER}@${HOST}"

usage() {
  echo "Usage:"
  echo "  QRS_HOST=... QRS_USER=... $0 list"
  echo "  QRS_HOST=... QRS_USER=... $0 latest"
  echo "  QRS_HOST=... QRS_USER=... $0 <archive-name.tgz>"
}

cmd="${1:-list}"

if [[ "${cmd}" == "list" ]]; then
  ssh "${REMOTE}" "ls -1t '${APP_DIR}/releases' | head -n 20" || true
  exit 0
fi

archive="${cmd}"
if [[ "${cmd}" == "latest" ]]; then
  archive="$(ssh "${REMOTE}" "ls -1t '${APP_DIR}/releases'/qrscaner-*.tgz 2>/dev/null | head -n 1" || true)"
  if [[ -z "${archive}" ]]; then
    echo "No releases found in ${APP_DIR}/releases"
    exit 1
  fi
else
  archive="${APP_DIR}/releases/${archive}"
fi

tmp_dir="/tmp/qrscaner-rollback-$(date -u +%Y%m%dT%H%M%SZ)"

echo "Rollback from: ${archive}"
ssh "${REMOTE}" "set -e; systemctl stop '${SERVICE}' || true; mkdir -p '${tmp_dir}'; tar -xzf '${archive}' -C '${tmp_dir}'; rsync -az --delete --exclude 'data/' --exclude '.env' --exclude 'venv/' --exclude 'webapp/node_modules/' --exclude 'releases/' --exclude 'attendance_core/target/' '${tmp_dir}/' '${APP_DIR}/'; rm -rf '${tmp_dir}'; cd '${APP_DIR}/webapp' && npm install && npm run build; if command -v cargo >/dev/null 2>&1 && [ -f '${APP_DIR}/attendance_core/Cargo.toml' ]; then cd '${APP_DIR}/attendance_core' && (cargo build --release || (rm -f Cargo.lock && cargo generate-lockfile && cargo build --release)) || echo 'attendance_core build failed'; fi; systemctl start '${SERVICE}'; systemctl is-active '${SERVICE}'"

echo "Health check"
ssh "${REMOTE}" "set -e; for i in \$(seq 1 25); do if curl -fsS http://127.0.0.1:8080/api/health >/dev/null; then echo OK; exit 0; fi; sleep 1; done; echo 'Health check failed' >&2; exit 1"
