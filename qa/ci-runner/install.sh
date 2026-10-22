#!/usr/bin/env bash
# Install the FitCircle always-on runner for the current user (no sudo).
#
#   qa/ci-runner/install.sh            install + load launchd agents, schedule PAUSED
#   qa/ci-runner/install.sh --active   install + load, schedule active immediately
#   qa/ci-runner/install.sh --no-load  copy files and write plists only
#
# What it writes (and nothing else):
#   ~/FitCircleCI/bin/{fitcircle-ci.sh,render_report.py}
#   ~/FitCircleCI/{config.env (if absent), PAUSED (unless --active), logs/, reports/, state/}
#   ~/Library/LaunchAgents/ai.fitcircle.ci.poll.plist     every 10 min → fitcircle-ci poll
#   ~/Library/LaunchAgents/ai.fitcircle.ci.nightly.plist  02:00 daily  → fitcircle-ci nightly
# Undo everything with qa/ci-runner/uninstall.sh.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
FC_HOME="${FC_HOME:-$HOME/FitCircleCI}"
AGENTS="$HOME/Library/LaunchAgents"
MODE="paused"
for a in "$@"; do case "$a" in --active) MODE=active;; --no-load) MODE=noload;; *) echo "unknown option $a"; exit 2;; esac; done

mkdir -p "$FC_HOME/bin" "$FC_HOME/logs" "$FC_HOME/reports" "$FC_HOME/state" "$AGENTS"
install -m 755 "$HERE/fitcircle-ci.sh" "$FC_HOME/bin/fitcircle-ci.sh"
install -m 644 "$HERE/render_report.py" "$FC_HOME/bin/render_report.py"
[ -f "$FC_HOME/config.env" ] || install -m 644 "$HERE/config.env.example" "$FC_HOME/config.env"
if [ -f "$FC_HOME/secrets.env" ]; then chmod 600 "$FC_HOME/secrets.env"; else
  echo "NOTE: $FC_HOME/secrets.env missing — Maestro suites will fail until QA_EMAIL/QA_PASSWORD are set (scripts/qa-account)."; fi
[ "$MODE" = active ] && rm -f "$FC_HOME/PAUSED" || touch "$FC_HOME/PAUSED"

plist() { # label, command, schedule-xml
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$FC_HOME/bin/fitcircle-ci.sh</string><string>$2</string></array>
  $3
  <key>EnvironmentVariables</key>
  <dict>
    <key>FC_HOME</key><string>$FC_HOME</string>
    <key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>LANG</key><string>en_US.UTF-8</string>
  </dict>
  <key>StandardOutPath</key><string>$FC_HOME/logs/$2.log</string>
  <key>StandardErrorPath</key><string>$FC_HOME/logs/$2.log</string>
  <key>ProcessType</key><string>Background</string>
  <key>LowPriorityIO</key><true/>
  <key>Nice</key><integer>5</integer>
</dict>
</plist>
EOF
}
plist ai.fitcircle.ci.poll poll "<key>StartInterval</key><integer>600</integer>" >"$AGENTS/ai.fitcircle.ci.poll.plist"
plist ai.fitcircle.ci.nightly nightly "<key>StartCalendarInterval</key><dict><key>Hour</key><integer>2</integer><key>Minute</key><integer>0</integer></dict>" >"$AGENTS/ai.fitcircle.ci.nightly.plist"
plutil -lint "$AGENTS/ai.fitcircle.ci.poll.plist" "$AGENTS/ai.fitcircle.ci.nightly.plist" >/dev/null

# Convenience symlink (only if ~/bin or /opt/homebrew/bin is writable and nothing is there).
for d in /opt/homebrew/bin "$HOME/bin"; do
  if [ -d "$d" ] && [ -w "$d" ] && [ ! -e "$d/fitcircle-ci" ]; then ln -s "$FC_HOME/bin/fitcircle-ci.sh" "$d/fitcircle-ci"; echo "linked $d/fitcircle-ci"; break; fi
done

if [ "$MODE" != noload ]; then
  for l in poll nightly; do
    launchctl bootout "gui/$(id -u)/ai.fitcircle.ci.$l" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$AGENTS/ai.fitcircle.ci.$l.plist"
  done
fi
echo "Installed FitCircle CI runner in $FC_HOME (mode: $MODE)."
[ "$MODE" = paused ] && echo "Schedule is PAUSED. Enable with: $FC_HOME/bin/fitcircle-ci.sh resume"
"$FC_HOME/bin/fitcircle-ci.sh" status | head -6
