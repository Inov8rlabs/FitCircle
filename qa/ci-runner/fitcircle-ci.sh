#!/usr/bin/env bash
# FitCircle always-on Mac test runner.
#
#   fitcircle-ci poll             fetch each repo; on a new commit run its "commit" suites
#   fitcircle-ci nightly          full regression for every repo (launchd runs this at 02:00)
#   fitcircle-ci run <repo> <suite>...   run suites now, e.g.  run ios unit snapshot
#   fitcircle-ci pause | resume   stop / allow scheduled runs (manual `run` always works)
#   fitcircle-ci status           schedule state, last run, last SHAs
#
# Repos: ios, android, backend. Each repo provides scripts/ci/run-tests.sh <suite>
# (see FitCircleBE/docs/TEST_PLAN.md §6 and §11). The runner keeps its own clones under
# $FC_HOME/repos so it never touches a developer checkout or worktree.
#
# Config: $FC_HOME/config.env (optional), $FC_HOME/secrets.env (QA_EMAIL, QA_PASSWORD,
# SLACK_WEBHOOK_URL, NOTIFY_EMAIL, RESEND_API_KEY). Reports: $FC_HOME/reports/<date>/<time>-<kind>/.
set -uo pipefail

FC_HOME="${FC_HOME:-$HOME/FitCircleCI}"
[ -f "$FC_HOME/config.env" ] && { set -a; . "$FC_HOME/config.env"; set +a; }

# ---- defaults (override in config.env) ------------------------------------------------------
: "${FC_BRANCH:=main}"
: "${FC_IOS_URL:=https://github.com/Inov8rlabs/FitCircle-iOS.git}"
: "${FC_ANDROID_URL:=https://github.com/Inov8rlabs/Fitcircle-Android.git}"
: "${FC_BACKEND_URL:=https://github.com/Inov8rlabs/FitCircle.git}"
: "${FC_IOS_BRANCH:=$FC_BRANCH}"
: "${FC_ANDROID_BRANCH:=$FC_BRANCH}"
: "${FC_BACKEND_BRANCH:=$FC_BRANCH}"
# Suites per trigger. Commit runs stay under ~25 min; nightly is the full regression.
: "${FC_COMMIT_SUITES_IOS:=unit snapshot maestro-smoke}"
: "${FC_COMMIT_SUITES_ANDROID:=unit screenshot compose-ui maestro-smoke}"
: "${FC_COMMIT_SUITES_BACKEND:=unit}"
: "${FC_NIGHTLY_SUITES_IOS:=unit snapshot maestro-regression}"
: "${FC_NIGHTLY_SUITES_ANDROID:=unit screenshot compose-ui maestro-regression}"
: "${FC_NIGHTLY_SUITES_BACKEND:=unit smoke}"
: "${FC_SUITE_TIMEOUT_MIN:=60}"
: "${FC_KEEP_DAYS:=30}"

export JAVA_HOME="${JAVA_HOME:-/Applications/Android Studio.app/Contents/jbr/Contents/Home}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$HOME/.maestro/bin:$HOME/.bun/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export FC_QA_ENV_FILE="${FC_QA_ENV_FILE:-$FC_HOME/secrets.env}"
export MAESTRO_CLI_NO_ANALYTICS=1

REPOS_DIR="$FC_HOME/repos"; STATE_DIR="$FC_HOME/state"; LOG_DIR="$FC_HOME/logs"
mkdir -p "$REPOS_DIR" "$STATE_DIR" "$LOG_DIR" "$FC_HOME/reports"
HERE="$(cd "$(dirname "$0")" && pwd)"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }

repo_url()    { case "$1" in ios) echo "$FC_IOS_URL";; android) echo "$FC_ANDROID_URL";; backend) echo "$FC_BACKEND_URL";; esac; }
repo_branch() { case "$1" in ios) echo "$FC_IOS_BRANCH";; android) echo "$FC_ANDROID_BRANCH";; backend) echo "$FC_BACKEND_BRANCH";; esac; }
suites_for()  { local v="FC_$(echo "$2" | tr a-z A-Z)_SUITES_$(echo "$1" | tr a-z A-Z)"; echo "${!v}"; }  # $1 repo $2 commit|nightly

# ---- locking: one run at a time (poll ticks that overlap a long run just exit) ---------------
LOCK="$FC_HOME/.lock"
acquire_lock() {
  if mkdir "$LOCK" 2>/dev/null; then echo $$ >"$LOCK/pid"; trap 'rm -rf "$LOCK"' EXIT; return 0; fi
  local pid; pid="$(cat "$LOCK/pid" 2>/dev/null)"
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then log "another run is active (pid $pid); skipping"; return 1; fi
  rm -rf "$LOCK"; acquire_lock
}

# ---- repos ------------------------------------------------------------------------------------
sync_repo() { # $1 repo → prints new SHA (checked out, clean)
  local r="$1" dir="$REPOS_DIR/$1" url branch
  url="$(repo_url "$r")"; branch="$(repo_branch "$r")"
  if [ ! -d "$dir/.git" ]; then
    git clone --quiet --branch "$branch" "$url" "$dir" >&2 || return 1
  fi
  git -C "$dir" remote set-url origin "$url"
  git -C "$dir" fetch --quiet origin "$branch" >&2 || return 1
  git -C "$dir" checkout --quiet --force -B "ci-$branch" "origin/$branch" >&2 || return 1
  git -C "$dir" clean -fdq -e build -e node_modules -e .gradle >&2
  git -C "$dir" rev-parse HEAD
}

remote_sha() { git ls-remote "$(repo_url "$1")" "refs/heads/$(repo_branch "$1")" 2>/dev/null | cut -f1; }

prepare_repo() { # one-time dependency setup per checkout (backend needs node_modules)
  local r="$1" dir="$REPOS_DIR/$1"
  if [ "$r" = backend ]; then
    local stamp="$dir/node_modules/.fc-lock-$(shasum "$dir/bun.lock" "$dir/package.json" 2>/dev/null | shasum | cut -c1-10)"
    if [ ! -f "$stamp" ]; then
      log "installing backend dependencies"
      ( cd "$dir" && { command -v bun >/dev/null && bun install --frozen-lockfile || npm install --no-audit --no-fund; } ) >"$RUN_DIR/backend-install.log" 2>&1 \
        && touch "$stamp"
    fi
  fi
}

# ---- one suite --------------------------------------------------------------------------------
run_suite() { # $1 repo $2 suite → appends a row to $RUN_DIR/results.tsv
  local r="$1" s="$2" dir="$REPOS_DIR/$1" out="$RUN_DIR/$1/$2" start end rc line
  mkdir -p "$out"
  if [ ! -x "$dir/scripts/ci/run-tests.sh" ]; then
    log "$r/$s: scripts/ci/run-tests.sh missing on $(repo_branch "$r") — skipped"
    printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$r" "$s" "skipped" 0 0 1 0 >>"$RUN_DIR/results.tsv"; return 0
  fi
  log "$r/$s: start"
  start=$(date +%s)
  FC_REPORT_DIR="$out" FC_DERIVED_DATA="$FC_HOME/DerivedData/$r" \
    /usr/bin/perl -e 'alarm shift; exec @ARGV' "$((FC_SUITE_TIMEOUT_MIN * 60))" \
    "$dir/scripts/ci/run-tests.sh" "$s" >"$out/console.log" 2>&1
  rc=$?; end=$(date +%s)
  line="$(grep -E '^SUMMARY ' "$out/console.log" | tail -1)"
  local p f k
  p="$(sed -nE 's/.*passed=([0-9]+).*/\1/p' <<<"$line")"; f="$(sed -nE 's/.*failed=([0-9]+).*/\1/p' <<<"$line")"
  k="$(sed -nE 's/.*skipped=([0-9]+).*/\1/p' <<<"$line")"
  [ $rc -eq 142 ] && echo "TIMEOUT after ${FC_SUITE_TIMEOUT_MIN} min" >>"$out/console.log"
  local status=pass; [ $rc -ne 0 ] && status=fail
  [ "$status" = fail ] && [ "${f:-0}" = 0 ] && f=1
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$r" "$s" "$status" "${p:-0}" "${f:-0}" "${k:-0}" "$((end - start))" >>"$RUN_DIR/results.tsv"
  log "$r/$s: $status (passed=${p:-0} failed=${f:-0} skipped=${k:-0}, $((end - start))s)"
}

# ---- reporting --------------------------------------------------------------------------------
finish_run() { # $1 kind
  local kind="$1"
  /usr/bin/python3 "$HERE/render_report.py" "$RUN_DIR" "$kind" >"$RUN_DIR/summary.txt" 2>"$RUN_DIR/render.err" || true
  ln -sfn "$RUN_DIR" "$FC_HOME/reports/latest"
  local title body failed
  failed="$(awk -F'\t' '$3=="fail"' "$RUN_DIR/results.tsv" | wc -l | tr -d ' ')"
  if [ "$failed" = 0 ]; then title="FitCircle CI ✅ $kind passed"; else title="FitCircle CI ❌ $kind: $failed suite(s) failed"; fi
  body="$(head -1 "$RUN_DIR/summary.txt" 2>/dev/null)"
  log "$title — $body — $RUN_DIR/index.html"
  notify "$title" "$body" "$RUN_DIR/summary.txt"
  # retention
  find "$FC_HOME/reports" -mindepth 1 -maxdepth 1 -type d -mtime +"$FC_KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
}

notify() { # $1 title $2 one-line body $3 full text file
  local title="$1" body="$2" file="$3"
  /usr/bin/osascript -e "display notification \"${body//\"/\\\"}\" with title \"${title//\"/\\\"}\" sound name \"Glass\"" >/dev/null 2>&1 || true
  [ -f "$FC_QA_ENV_FILE" ] && { set -a; . "$FC_QA_ENV_FILE"; set +a; }
  if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
    /usr/bin/python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1] + "\n```" + open(sys.argv[2]).read()[:3500] + "```"}))' "$title" "$file" \
      | curl -fsS -m 20 -H 'Content-Type: application/json' --data @- "$SLACK_WEBHOOK_URL" >/dev/null 2>&1 || log "slack notify failed"
  fi
  if [ -n "${NOTIFY_EMAIL:-}" ]; then
    if [ -n "${RESEND_API_KEY:-}" ]; then
      /usr/bin/python3 -c 'import json,sys; print(json.dumps({"from": sys.argv[3], "to": [sys.argv[2]], "subject": sys.argv[1], "text": open(sys.argv[4]).read()}))' \
        "$title" "$NOTIFY_EMAIL" "${NOTIFY_FROM:-FitCircle CI <ci@fitcircle.ai>}" "$file" \
        | curl -fsS -m 20 -H "Authorization: Bearer $RESEND_API_KEY" -H 'Content-Type: application/json' --data @- https://api.resend.com/emails >/dev/null 2>&1 || log "email notify failed"
    else
      /usr/bin/mail -s "$title" "$NOTIFY_EMAIL" <"$file" >/dev/null 2>&1 || log "email notify failed (no RESEND_API_KEY; local mail not configured?)"
    fi
  fi
}

new_run_dir() { # $1 kind
  RUN_DIR="$FC_HOME/reports/$(date +%Y-%m-%d)/$(date +%H%M%S)-$1"
  mkdir -p "$RUN_DIR"; : >"$RUN_DIR/results.tsv"
  exec > >(tee -a "$RUN_DIR/runner.log") 2>&1
}

paused() { [ -f "$FC_HOME/PAUSED" ]; }

# ---- commands ---------------------------------------------------------------------------------
cmd_poll() {
  if paused; then log "paused ($FC_HOME/PAUSED exists) — poll skipped"; return 0; fi
  # Cheap check first: ls-remote; only lock + run when something changed.
  local changed=() r sha
  for r in ios android backend; do
    sha="$(remote_sha "$r")"
    [ -z "$sha" ] && { log "$r: cannot reach $(repo_url "$r")"; continue; }
    [ "$sha" != "$(cat "$STATE_DIR/$r.sha" 2>/dev/null)" ] && changed+=("$r")
  done
  [ ${#changed[@]} -eq 0 ] && { log "no new commits"; return 0; }
  acquire_lock || return 0
  new_run_dir commit
  for r in "${changed[@]}"; do
    sha="$(sync_repo "$r")" || { log "$r: sync failed"; printf '%s\tsync\tfail\t0\t1\t0\t0\n' "$r" >>"$RUN_DIR/results.tsv"; continue; }
    echo "$r $(repo_branch "$r") $sha $(git -C "$REPOS_DIR/$r" log -1 --format='%an: %s' | cut -c1-90)" >>"$RUN_DIR/commits.txt"
    prepare_repo "$r"
    for s in $(suites_for "$r" commit); do run_suite "$r" "$s"; done
    echo "$sha" >"$STATE_DIR/$r.sha"
  done
  finish_run commit
}

cmd_nightly() {
  if paused && [ "${1:-}" != "--force" ]; then log "paused — nightly skipped"; return 0; fi
  acquire_lock || return 0
  new_run_dir nightly
  local r sha
  for r in ios android backend; do
    sha="$(sync_repo "$r")" || { printf '%s\tsync\tfail\t0\t1\t0\t0\n' "$r" >>"$RUN_DIR/results.tsv"; continue; }
    echo "$r $(repo_branch "$r") $sha $(git -C "$REPOS_DIR/$r" log -1 --format='%an: %s' | cut -c1-90)" >>"$RUN_DIR/commits.txt"
    prepare_repo "$r"
    for s in $(suites_for "$r" nightly); do run_suite "$r" "$s"; done
  done
  finish_run nightly
}

cmd_run() { # repo suite...
  local r="${1:?repo: ios|android|backend}"; shift
  [ $# -gt 0 ] || set -- $(suites_for "$r" commit)
  acquire_lock || return 1
  new_run_dir "manual-$r"
  local sha; sha="$(sync_repo "$r")" || { log "sync failed"; return 1; }
  echo "$r $(repo_branch "$r") $sha" >>"$RUN_DIR/commits.txt"
  prepare_repo "$r"
  for s in "$@"; do run_suite "$r" "$s"; done
  finish_run "manual-$r"
  awk -F'\t' '$3=="fail"{f=1} END{exit f}' "$RUN_DIR/results.tsv"
}

cmd_status() {
  echo "FC_HOME: $FC_HOME"
  paused && echo "Schedule: PAUSED (fitcircle-ci resume to enable)" || echo "Schedule: active"
  launchctl print "gui/$(id -u)/ai.fitcircle.ci.poll" >/dev/null 2>&1 && echo "launchd poll agent: loaded" || echo "launchd poll agent: not loaded"
  launchctl print "gui/$(id -u)/ai.fitcircle.ci.nightly" >/dev/null 2>&1 && echo "launchd nightly agent: loaded" || echo "launchd nightly agent: not loaded"
  for r in ios android backend; do echo "$r: $(repo_branch "$r") last tested $(cat "$STATE_DIR/$r.sha" 2>/dev/null || echo never)"; done
  [ -L "$FC_HOME/reports/latest" ] && { echo "latest: $(readlink "$FC_HOME/reports/latest")"; head -20 "$FC_HOME/reports/latest/summary.txt" 2>/dev/null; }
}

case "${1:-}" in
  poll) cmd_poll ;;
  nightly) shift; cmd_nightly "$@" ;;
  run) shift; cmd_run "$@" ;;
  pause) touch "$FC_HOME/PAUSED"; log "paused" ;;
  resume) rm -f "$FC_HOME/PAUSED"; log "resumed" ;;
  status) cmd_status ;;
  *) sed -n '2,16p' "$0"; exit 2 ;;
esac
