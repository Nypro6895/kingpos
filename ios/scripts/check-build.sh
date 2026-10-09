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

xcodebuild test \
  -project Reylumi.xcodeproj -scheme Reylumi \
  -destination "platform=iOS Simulator,id=$task_simulator_id" \
  -derivedDataPath "$task_run_dir/DerivedData" \
  -resultBundlePath "$task_run_dir/SimulatorTests.xcresult" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/test.log

xcodebuild archive \
  -project Reylumi.xcodeproj -scheme Reylumi -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$task_run_dir/Reylumi-unsigned.xcarchive" \
  -derivedDataPath "$task_run_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/archive.log

# Confirm that the bridge is actually bundled, rather than testing JS source alone.
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/NativeBridge.js"
python3 - "$task_run_dir" "$task_simulator_id" <<'PY'
import hashlib, json, os, pathlib, subprocess, sys
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
    "installableOnIPhone": False, "runDirectory": str(run.relative_to(root)),
    "githubRun": os.environ.get("GITHUB_RUN_ID"), "sourceSHA256": hashes,
}
(root / "build/build-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
PY
echo "Simulator tests and unsigned device archive passed. Signing is still required for TestFlight."
