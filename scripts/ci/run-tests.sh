#!/usr/bin/env bash
# FitCircle backend test entrypoint for the launchd runner and self-hosted CI.
#
#   scripts/ci/run-tests.sh unit    # vitest (apps/web), JUnit + HTML into $FC_REPORT_DIR
#   scripts/ci/run-tests.sh smoke   # post-deploy prod smoke (scripts/smoke/prod-smoke.mjs)
#
# Env:
#   FC_REPORT_DIR   where reports go (default: ./.ci-reports/<suite>)
#   FC_QA_ENV_FILE  QA credentials file for smoke (default ~/FitCircleCI/secrets.env)
#   SMOKE_BASE_URL  smoke target (default https://www.fitcircle.ai)
#   FC_SKIP_INSTALL=1  don't run `bun install` even if node_modules is missing
#
# Exit 0 = pass. Last line: SUMMARY suite=<s> passed=<n> failed=<n> skipped=<n>
set -uo pipefail

SUITE="${1:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
REPORT_DIR="${FC_REPORT_DIR:-$ROOT/.ci-reports/$SUITE}"
mkdir -p "$REPORT_DIR"

summary_from_junit() { # $1 junit file -> prints counts "passed failed skipped"
  python3 - "$1" <<'PY'
import sys, xml.etree.ElementTree as ET
try:
    root = ET.parse(sys.argv[1]).getroot()
except Exception:
    print("0 0 0"); sys.exit()
cases = list(root.iter("testcase"))
failed = sum(1 for c in cases if c.find("failure") is not None or c.find("error") is not None)
skipped = sum(1 for c in cases if c.find("skipped") is not None)
print(len(cases) - failed - skipped, failed, skipped)
PY
}

ensure_deps() {
  if [[ ! -d "$ROOT/node_modules" && "${FC_SKIP_INSTALL:-0}" != "1" ]]; then
    echo "Installing dependencies (bun install --frozen-lockfile)…"
    (cd "$ROOT" && bun install --frozen-lockfile) || { echo "bun install failed"; return 1; }
  fi
}

case "$SUITE" in
  unit)
    ensure_deps || { echo "SUMMARY suite=unit passed=0 failed=1 skipped=0"; exit 1; }
    JUNIT="$REPORT_DIR/backend-unit.junit.xml"
    (cd "$ROOT/apps/web" && npx vitest run \
        --reporter=default --reporter=junit --reporter=html \
        --outputFile.junit="$JUNIT" --outputFile.html="$REPORT_DIR/vitest-html/index.html") \
      > "$REPORT_DIR/backend-unit.log" 2>&1
    rc=$?
    tail -25 "$REPORT_DIR/backend-unit.log"
    read -r P F S < <(summary_from_junit "$JUNIT")
    # vitest can exit non-zero for an unhandled error even when every case passed.
    [[ $rc -ne 0 && "$F" == "0" ]] && F=1
    echo "SUMMARY suite=unit passed=$P failed=$F skipped=$S"
    exit $rc
    ;;
  smoke)
    node "$ROOT/scripts/smoke/prod-smoke.mjs" --junit "$REPORT_DIR/backend-smoke.junit.xml" 2>&1 | tee "$REPORT_DIR/backend-smoke.log"
    exit "${PIPESTATUS[0]}"
    ;;
  *)
    echo "usage: $0 unit|smoke" >&2
    exit 2
    ;;
esac
