#!/usr/bin/env bash
set -euo pipefail

# Always use the iOS source directory, regardless of the caller's directory.
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This check requires macOS and Xcode; use the GitHub iOS build workflow from Windows." >&2
  exit 1
fi
command -v xcodegen >/dev/null || { echo "Install XcodeGen before running this check." >&2; exit 1; }
mkdir -p build
# A distinct run directory keeps old test results from interfering with a rerun.
task_run_dir="$(mktemp -d "$PWD/build/check.XXXXXX")"
xcodebuild -version
xcodegen generate

# Select an installed iPhone instead of assuming a particular device name.
xcrun simctl list devices available --json > "$task_run_dir/devices.json"
task_simulator_id="$(python3 - "$task_run_dir/devices.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    devices = json.load(stream)["devices"]
for runtime, entries in devices.items():
    if ".iOS-" not in runtime:
        continue
    for device in entries:
        if device.get("isAvailable") and device["name"].startswith("iPhone"):
            print(device["udid"])
            sys.exit(0)
sys.exit("No available iPhone Simulator is installed in this Xcode environment.")
PY
)"

# Simulator Keychain access still requires the host's signed application ID.
# Ad-hoc signing needs no device certificate/profile, and this entitlements file
# applies only to these simulator commands, never the Release/device archive.
task_simulator_signing=(CODE_SIGNING_ALLOWED=YES CODE_SIGNING_REQUIRED=YES
  CODE_SIGN_STYLE=Manual CODE_SIGN_IDENTITY=-
  "CODE_SIGN_ENTITLEMENTS=$PWD/ReylumiTests/Simulator.entitlements")
xcodebuild build-for-testing \
  -project Reylumi.xcodeproj -scheme Reylumi -configuration Debug \
  -destination "platform=iOS Simulator,id=$task_simulator_id" \
  -derivedDataPath "$task_run_dir/DerivedData" \
  "${task_simulator_signing[@]}" 2>&1 | tee build/test-build.log

task_simulator_app="$task_run_dir/DerivedData/Build/Products/Debug-iphonesimulator/Reylumi.app"
codesign --verify --deep --strict "$task_simulator_app"
codesign -d --entitlements :- "$task_simulator_app" > "$task_run_dir/SimulatorEntitlements.plist" 2> "$task_run_dir/SimulatorSigning.log"
python3 - "$task_simulator_app/Info.plist" "$task_run_dir/SimulatorEntitlements.plist" <<'PY'
import pathlib, plistlib, re, sys
info = plistlib.loads(pathlib.Path(sys.argv[1]).read_bytes())
entitlements = plistlib.loads(pathlib.Path(sys.argv[2]).read_bytes())
team = entitlements.get("com.apple.developer.team-identifier", "")
assert re.fullmatch(r"[A-Z0-9]{10}", team), "Simulator host has no valid signing team entitlement"
identifier = team + "." + info["CFBundleIdentifier"]
assert entitlements.get("application-identifier") == identifier, "Simulator host has no own application-identifier entitlement"
assert entitlements.get("keychain-access-groups") == [identifier], "Simulator Keychain group must be the host app's own identifier only"
print("Ad-hoc Simulator host signature and own Keychain entitlement verified.")
PY

xcodebuild test-without-building \
  -project Reylumi.xcodeproj -scheme Reylumi -configuration Debug \
  -destination "platform=iOS Simulator,id=$task_simulator_id" \
  -derivedDataPath "$task_run_dir/DerivedData" \
  -resultBundlePath "$task_run_dir/SimulatorTests.xcresult" \
  "${task_simulator_signing[@]}" 2>&1 | tee build/test.log

xcodebuild archive \
  -project Reylumi.xcodeproj -scheme Reylumi -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$task_run_dir/Reylumi-unsigned.xcarchive" \
  -derivedDataPath "$task_run_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/archive.log

# Confirm that the bridge is actually bundled, rather than testing JS source alone.
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/NativeBridge.js"
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/AppViewport.js"
python3 - "$task_run_dir" "$task_simulator_id" <<'PY'
import hashlib, json, os, pathlib, plistlib, subprocess, sys
root = pathlib.Path.cwd()
run = pathlib.Path(sys.argv[1])
paths = [root / "project.yml"]
for directory in ("Reylumi", "ReylumiTests", "scripts"):
    paths.extend(path for path in (root / directory).rglob("*") if path.is_file())
hashes = {str(path.relative_to(root)): hashlib.sha256(path.read_bytes()).hexdigest() for path in sorted(paths)}
receipt = {
    "commit": subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip(),
    "xcode": subprocess.check_output(["xcodebuild", "-version"], text=True).strip(),
    "simulator": sys.argv[2], "simulatorTests": "passed", "deviceArchive": "unsigned",
    "simulatorSigning": "ad-hoc; own application-identifier and Keychain access group verified",
    "simulatorEntitlements": plistlib.loads((run / "SimulatorEntitlements.plist").read_bytes()),
    "installableOnIPhone": False, "runDirectory": str(run.relative_to(root)),
    "githubRun": os.environ.get("GITHUB_RUN_ID"), "sourceSHA256": hashes,
}
(root / "build/build-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
PY
echo "Simulator tests and unsigned device archive passed. Signing is still required for TestFlight."
