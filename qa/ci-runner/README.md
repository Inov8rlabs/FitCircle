# FitCircle always-on Mac runner

A small launchd-driven CI for the three FitCircle repos on one Mac: this MacBook Pro now, a Mac mini later. The test strategy and release gates are in [docs/TEST_PLAN.md](../../docs/TEST_PLAN.md).

```
launchd ai.fitcircle.ci.poll     (every 10 min) → fitcircle-ci poll     → new commit on main? run commit suites
launchd ai.fitcircle.ci.nightly  (02:00)        → fitcircle-ci nightly  → full regression + prod smoke
                       │
                       └─ ~/FitCircleCI/repos/{ios,android,backend}/scripts/ci/run-tests.sh <suite>
                          → ~/FitCircleCI/reports/<date>/<time>-<kind>/{index.html,summary.txt,results.tsv,<repo>/<suite>/…}
                          → macOS notification (+ Slack webhook / email if configured)
```

| Trigger | iOS | Android | Backend | Typical time (M-series, warm) |
|---|---|---|---|---|
| commit (poll) | unit, snapshot, maestro-smoke | unit, screenshot, compose-ui, maestro-smoke | unit | 10–25 min for the changed repo |
| nightly 02:00 | unit, snapshot, maestro-regression | unit, screenshot, compose-ui, maestro-regression | unit, smoke | 45–70 min |

One run happens at a time (a lock directory). A poll tick that overlaps a running job exits. Each suite has a 60-minute timeout (`FC_SUITE_TIMEOUT_MIN`).

## Install / uninstall (no sudo)

```sh
cd FitCircleBE            # any checkout of this repo
qa/ci-runner/install.sh            # installs + loads agents, schedule PAUSED (nothing heavy starts)
~/FitCircleCI/bin/fitcircle-ci.sh resume   # enable the schedule
~/FitCircleCI/bin/fitcircle-ci.sh status

qa/ci-runner/install.sh --active   # install and enable in one go
qa/ci-runner/uninstall.sh          # unload agents, remove plists + ~/FitCircleCI/bin (keeps reports/clones/secrets)
qa/ci-runner/uninstall.sh --purge  # also delete ~/FitCircleCI and the CI simulator + AVD
```

Files installed: `~/FitCircleCI/bin/{fitcircle-ci.sh,render_report.py}`, `~/FitCircleCI/config.env` (if absent), `~/Library/LaunchAgents/ai.fitcircle.ci.{poll,nightly}.plist`, and, if the directory is writable and the name is free, a `fitcircle-ci` symlink in `/opt/homebrew/bin` or `~/bin`.

The agents are **LaunchAgents** (they run in your login session), not LaunchDaemons. The iOS Simulator and the Android emulator need a logged-in GUI session, so on a Mac mini enable automatic login (see below).

## Everyday commands

```sh
fitcircle-ci run ios unit snapshot           # run suites now (ignores PAUSED)
fitcircle-ci run android maestro-smoke
fitcircle-ci run backend smoke
fitcircle-ci nightly --force                 # full regression now
fitcircle-ci pause | resume | status
open ~/FitCircleCI/reports/latest/index.html
tail -f ~/FitCircleCI/logs/poll.log
```

Testing an unpushed branch: in `~/FitCircleCI/config.env` set, for example, `FC_IOS_URL=/Users/ani/Code/FitCircle/FitCircle-iOS-tests` and `FC_IOS_BRANCH=feat/test-automation`.

## Configuration

- `~/FitCircleCI/config.env`: branches, clone URLs, and suites per trigger (see `config.env.example`).
- `~/FitCircleCI/secrets.env` (chmod 600, never in git):
  ```sh
  QA_EMAIL=qa.automation@fitcircle.ai
  QA_PASSWORD=…                 # written by scripts/qa-account/seed.mjs --apply
  SLACK_WEBHOOK_URL=https://hooks.slack.com/services/…   # optional
  NOTIFY_EMAIL=you@example.com  # optional; uses RESEND_API_KEY if set, else /usr/bin/mail
  RESEND_API_KEY=re_…           # optional
  ```
- **Login rate limit:** prod `/api/mobile/auth/login` allows 5 attempts per 15 minutes per IP. A smoke run signs in once per platform, so keep manual Maestro reruns spaced out. Prod smoke caches a refresh token in `~/FitCircleCI/.qa-token-cache.json`.

## Devices

The runner uses **only** its own devices and never touches developer simulators or AVDs.

- **"FitCircle CI iPhone"**: iPhone 17 Pro on the newest iOS runtime that supports it. The iOS script creates it if it's missing.
  ```sh
  xcrun simctl create "FitCircle CI iPhone" com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro com.apple.CoreSimulator.SimRuntime.iOS-27-0
  ```
- **"FitCircle CI Pixel"**: AVD `FitCircle_CI_Pixel` (Pixel profile, `system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a`). The Android script boots it headless when needed and shuts it down afterwards.
  ```sh
  sdkmanager "system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a"
  avdmanager create avd -n FitCircle_CI_Pixel -k "system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a" -d pixel_9
  ```

## Moving to a Mac mini

1. **macOS account.** Create a standard user such as `ci`. Turn on *Automatic login* for it (System Settings → Users & Groups) so LaunchAgents and the simulators run after a reboot. Set *Energy → Prevent automatic sleeping* and *Start up automatically after a power failure*. Optionally enable Screen Sharing and SSH (Remote Login) for maintenance.
2. **Xcode.** Install the same Xcode as the developer Mac (currently 27.1) from Xcode Releases or the App Store. Then run:
   ```sh
   sudo xcode-select -s /Applications/Xcode.app
   sudo xcodebuild -license accept
   xcodebuild -runFirstLaunch
   xcodebuild -downloadPlatform iOS          # simulator runtime
   ```
   `xcode-select` must point at a full Xcode, because `xcodebuild test` resolves `simctl` through it.
3. **Android SDK and Java.** Install Android Studio (this provides the JBR at `/Applications/Android Studio.app/Contents/jbr/Contents/Home`), or install a JDK 21 and set `JAVA_HOME` in `config.env`. Then:
   ```sh
   export ANDROID_HOME=~/Library/Android/sdk
   sdkmanager "platform-tools" "emulator" "platforms;android-37" "build-tools;37.0.0" \
              "system-images;android-37.0;google_apis_playstore_ps16k;arm64-v8a" "cmdline-tools;latest"
   ```
   Create the AVD as described in Devices. Copy `~/.android/debug.keystore` if you need debug-signature parity, for example for Google sign-in on debug builds.
4. **Maestro.** Use a pinned version, unpacked without editing shell rc files:
   ```sh
   curl -fsSL -o /tmp/maestro.zip https://github.com/mobile-dev-inc/maestro/releases/download/cli-2.11.0/maestro.zip
   mkdir -p ~/.maestro && unzip -q -o /tmp/maestro.zip -d /tmp/maestro && cp -R /tmp/maestro/maestro/* ~/.maestro/
   JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ~/.maestro/bin/maestro --version
   ```
5. **Node and Bun** for the backend: `brew install node` and `curl -fsSL https://bun.sh/install | bash`.
6. **Git credentials.** The runner clones over HTTPS. Use `gh auth login` and `gh auth setup-git`, or a fine-grained PAT with read-only *Contents* on the three repos stored in the login keychain. Check with `git ls-remote https://github.com/Inov8rlabs/FitCircle-iOS.git`.
7. **Secrets.** Copy `~/FitCircleCI/secrets.env` over a secure channel, or regenerate it: run `node scripts/qa-account/seed.mjs --apply --rotate-password` with the prod service key in env. Rotating the password invalidates the old Mac's copy.
8. **Install.** Run `qa/ci-runner/install.sh` and `fitcircle-ci nightly --force` once while you watch, then `fitcircle-ci resume`.
9. **First run** builds everything from scratch, roughly 15 minutes for iOS SwiftPM and 10 for Gradle. After that, runs are incremental. DerivedData lives in `~/FitCircleCI/DerivedData`.
10. **Uninstall** on the old Mac: `qa/ci-runner/uninstall.sh --purge`.

Disk: plan for about 40 GB (DerivedData about 10, Gradle caches about 8, simulator and AVD about 12, reports 1–3 per month at 30-day retention).

## GitHub self-hosted runner (optional, same Mac)

Hosted runners for the private iOS and Android repos are blocked while the GitHub billing issue is open. The backend repo is public, so its hosted runners work. Each repo ships a workflow that targets `runs-on: [self-hosted, macOS, fitcircle]`. To register this Mac (repo admin; one runner per repo, or an org-level runner if you have `admin:org`):

```sh
mkdir -p ~/actions-runner/fitcircle-ios && cd ~/actions-runner/fitcircle-ios
curl -fsSLO https://github.com/actions/runner/releases/download/v<ver>/actions-runner-osx-arm64-<ver>.tar.gz && tar xzf actions-runner-osx-arm64-*.tar.gz
TOKEN=$(gh api -X POST repos/Inov8rlabs/FitCircle-iOS/actions/runners/registration-token --jq .token)
./config.sh --url https://github.com/Inov8rlabs/FitCircle-iOS --token "$TOKEN" --labels fitcircle --name "$(hostname -s)-fitcircle" --unattended
./svc.sh install && ./svc.sh start        # LaunchAgent, same login-session requirement
```

Repeat for `Fitcircle-Android` and `FitCircle`. If jobs still show "not started because recent account payments have failed", self-hosted jobs are blocked by the billing state too. In that case keep using the launchd runner, which needs no GitHub Actions at all. Don't run the GitHub runner and the launchd runner on the same devices at the same time; pause one (`fitcircle-ci pause`).

## Troubleshooting

- `unable to find utility simctl`: `xcode-select -p` points at CommandLineTools. Run `sudo xcode-select -s /Applications/Xcode.app`.
- Maestro iOS hangs on "Waiting for XCTest driver": run `xcrun simctl shutdown "FitCircle CI iPhone"`, then rerun. Maestro reinstalls the driver.
- Emulator won't boot under launchd: check `~/FitCircleCI/reports/latest/android/maestro-smoke/emulator.log`. Hypervisor.framework needs the GUI session (automatic login).
- 429 on sign-in: the login rate limit. Wait 15 minutes.
