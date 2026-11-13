#!/usr/bin/env bash
# Release preflight: run before ANY App Store or Play Store submission (and after
# backend deploys). One command, non-zero exit on any failure.
#
#   scripts/release-preflight.sh                 # contract test + prod smoke (read-only)
#   scripts/release-preflight.sh --base https://<deployment>.vercel.app
#   scripts/release-preflight.sh --writes        # extra args go to prod-smoke.mjs
#
# Steps:
#   1. DB contract test (apps/web/__tests__/unit/db-contract.test.ts): every Supabase
#      query in app code names tables/columns/FKs that exist in the prod schema snapshot.
#   2. Production smoke (scripts/smoke/prod-smoke.mjs --require-service-role): real
#      endpoints, signed in as the dedicated smoke account, decode-shape checks, and
#      "integrity health": over the last 24 h every Android auth action (register, login,
#      google, refresh) with token attempts has passes > 0 and < 20 % infrastructure
#      fail-opens (SKIP/WARN without data; docs/INTEGRITY_CONTRACT.md, Detection).
#
# Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and JWT_SECRET (prod) in the
# environment or in apps/web/.env.local (override the file with SMOKE_ENV_FILE).
# Values are never printed. See docs/RELEASE_CHECKLIST.md.
set -euo pipefail

root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
contract="apps/web/__tests__/unit/db-contract.test.ts"

echo "== 1/2 DB contract test"
if [[ ! -f "$root/$contract" ]]; then
  echo "FAIL: $contract not found in $root (is this checkout up to date with main?)" >&2
  exit 1
fi
(cd "$root/apps/web" && npx vitest run "__tests__/unit/db-contract.test.ts")

echo
echo "== 2/2 Production smoke"
node --no-deprecation "$root/scripts/smoke/prod-smoke.mjs" --require-service-role "$@"

echo
echo "Release preflight PASSED."
