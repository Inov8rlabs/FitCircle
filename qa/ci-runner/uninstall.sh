#!/usr/bin/env bash
# Remove the FitCircle runner's launchd agents and binaries.
#
#   qa/ci-runner/uninstall.sh           unload agents, remove plists + ~/FitCircleCI/bin (keeps reports, secrets, clones)
#   qa/ci-runner/uninstall.sh --purge   also delete ~/FitCircleCI entirely and the CI simulator/emulator
set -uo pipefail
FC_HOME="${FC_HOME:-$HOME/FitCircleCI}"
for l in poll nightly; do
  launchctl bootout "gui/$(id -u)/ai.fitcircle.ci.$l" 2>/dev/null && echo "unloaded ai.fitcircle.ci.$l"
  rm -f "$HOME/Library/LaunchAgents/ai.fitcircle.ci.$l.plist"
done
for d in /opt/homebrew/bin "$HOME/bin"; do
  [ -L "$d/fitcircle-ci" ] && [ "$(readlink "$d/fitcircle-ci")" = "$FC_HOME/bin/fitcircle-ci.sh" ] && rm -f "$d/fitcircle-ci" && echo "removed $d/fitcircle-ci"
done
rm -rf "$FC_HOME/bin" "$FC_HOME/.lock"
if [ "${1:-}" = "--purge" ]; then
  udid="$(xcrun simctl list devices | grep -F "FitCircle CI iPhone (" | sed -E 's/.*\(([0-9A-F-]{36})\).*/\1/' | head -1)"
  [ -n "$udid" ] && xcrun simctl delete "$udid" && echo "deleted simulator FitCircle CI iPhone"
  avdm="$HOME/Library/Android/sdk/cmdline-tools/latest/bin/avdmanager"
  if [ -x "$avdm" ]; then "$avdm" delete avd -n FitCircle_CI_Pixel 2>/dev/null && echo "deleted AVD FitCircle_CI_Pixel"
  else rm -rf "$HOME/.android/avd/FitCircle_CI_Pixel.avd" "$HOME/.android/avd/FitCircle_CI_Pixel.ini" && echo "deleted AVD FitCircle_CI_Pixel"; fi
  rm -rf "$FC_HOME" && echo "deleted $FC_HOME"
  echo "Maestro (~/.maestro) left in place; remove with: rm -rf ~/.maestro"
fi
echo "FitCircle CI runner uninstalled."
