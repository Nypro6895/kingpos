#!/usr/bin/env bash
set -euo pipefail

# Always use the iOS source directory, regardless of the caller's directory.
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This check requires macOS and Xcode; use the GitHub iOS build workflow from Windows." >&2
  exit 1
fi
command -v xcodegen >/dev/null || { echo "Install XcodeGen before running this check." >&2; exit 1; }
# Integrity of an inherited manifest is insufficient: require this source's rebuilt package.
node ../scripts/ios/local-bundle-release.mjs verify
# These tests exercise the real installed client, not only a generated fixture.
test -f Reylumi/LocalAppBundle/manifest.json
test -f Reylumi/AppLocalBridge.js
verify_local_package() {
  python3 - "$1" <<'PY'
import hashlib, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
manifest = json.loads((root / 'manifest.json').read_bytes())
for row in manifest['files']:
    file = root / row['path']
    data = file.read_bytes()
    assert len(data) == row['bytes'] and hashlib.sha256(data).hexdigest() == row['sha256'], 'Bundled resource integrity mismatch: ' + row['path']
print('Exact installed bundle bytes verified:', len(manifest['files']), 'resources, build', manifest['buildId'])
PY
}
# Catch checkout line-ending normalization before a costly Simulator run, and
# verify the same bytes again after Xcode copies/signs the resource directory.
verify_local_package Reylumi/LocalAppBundle
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

# Overlap the cold Simulator boot with compilation. Do not shorten any runtime
# capability test or replace it with a source assertion to make CI faster.
task_simulator_state="$(python3 - "$task_run_dir/devices.json" "$task_simulator_id" <<'PY'
import json, sys
devices = json.loads(open(sys.argv[1]).read())["devices"]
print(next(item["state"] for group in devices.values() for item in group if item["udid"] == sys.argv[2]))
PY
)"
if [[ "$task_simulator_state" == "Shutdown" ]]; then
  xcrun simctl boot "$task_simulator_id"
fi

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
test -f "$task_simulator_app/LocalAppBundle/manifest.json"
test -f "$task_simulator_app/AppLocalBridge.js"
verify_local_package "$task_simulator_app/LocalAppBundle"
codesign --verify --deep --strict "$task_simulator_app"
codesign -d --entitlements :- "$task_simulator_app" > "$task_run_dir/SimulatorSignatureEntitlements.plist" 2> "$task_run_dir/SimulatorSigning.log"
xcrun otool -l "$task_simulator_app/Reylumi" > "$task_run_dir/SimulatorLoadCommands.txt"
python3 - "$task_simulator_app" "$task_run_dir" <<'PY'
import pathlib, plistlib, re, sys
app, run = map(pathlib.Path, sys.argv[1:])
info = plistlib.loads((app / "Info.plist").read_bytes())
# Simulator APIs use the Mach-O __TEXT,__entitlements section. Xcode's ordinary
# ad-hoc code-signature entitlements can be {}, which is not an access failure.
sections, current = [], None
for line in (run / "SimulatorLoadCommands.txt").read_text().splitlines():
    if line.strip() == "Section" or line.strip().startswith("Load command "):
        if current:
            sections.append(current)
        current = None
        continue
    fields = line.strip().split(None, 1)
    if len(fields) != 2:
        continue
    key, value = fields
    if key == "sectname":
        if current:
            sections.append(current)
        current = {key: value}
    elif current is not None and key in ("segname", "offset", "size"):
        current[key] = value
if current:
    sections.append(current)
matches = [item for item in sections if item.get("sectname") == "__entitlements" and item.get("segname") == "__TEXT"]
assert len(matches) == 1, "Simulator host must embed exactly one own entitlement section"
section = matches[0]
offset, size = int(section["offset"], 0), int(section["size"], 0)
binary = (app / info["CFBundleExecutable"]).read_bytes()
assert size > 0 and offset >= 0 and offset + size <= len(binary), "Invalid Simulator entitlement section bounds"
embedded = binary[offset:offset + size].rstrip(b"\0")
entitlements = plistlib.loads(embedded)
(run / "SimulatorEntitlements.plist").write_bytes(plistlib.dumps(entitlements))
packaged = list((run / "DerivedData/Build/Intermediates.noindex").rglob("Reylumi.app-Simulated.xcent"))
assert len(packaged) == 1, "Simulator host's packaged entitlements are missing or ambiguous"
assert plistlib.loads(packaged[0].read_bytes()) == entitlements, "Actual host Mach-O entitlements differ from the packaged Simulator inputs"
team = entitlements.get("com.apple.developer.team-identifier", "")
assert re.fullmatch(r"[A-Z0-9]{10}", team), "Simulator host has no valid signing team entitlement"
identifier = team + "." + info["CFBundleIdentifier"]
assert entitlements.get("application-identifier") == identifier, "Simulator host has no own application-identifier entitlement"
assert entitlements.get("keychain-access-groups") == [identifier], "Simulator Keychain group must be the host app's own identifier only"
print("Ad-hoc signature and actual embedded Simulator application/own Keychain entitlements verified; runtime Keychain preflight follows.")
PY

xcrun simctl bootstatus "$task_simulator_id" -b
# Keep all tests, assertions and their timing budgets. Real WebKit/UIKit suites
# get separate host processes so a preceding suite cannot retain WK processes
# or windows into the next one. Persistent app data is not erased.
python3 - "$task_run_dir" <<'PY'
import json, pathlib, re, sys
run = pathlib.Path(sys.argv[1])
suites = []
for file in sorted(pathlib.Path("ReylumiTests").glob("*.swift")):
    text = file.read_text()
    methods = re.findall(r"\bfunc\s+(test\w+)\s*\(\s*\)", text)
    if not methods:
        continue
    names = re.findall(r"\bclass\s+(\w+)\s*:\s*XCTestCase\b", text)
    assert len(names) == 1, "Ambiguous XCTest suite: " + str(file)
    assert len(methods) == len(set(methods)), "Duplicate test method: " + str(file)
    suites.append({"suite": names[0], "methods": methods,
                   "isolatedHost": bool(re.search(r"import (?:WebKit|UIKit)\b", text))})
assert suites, "No XCTest suites discovered"
pure = ["ReylumiTests/" + item["suite"] for item in suites if not item["isolatedHost"]]
batches = ([{"name": "PureTransportAndState", "identifiers": pure}] if pure else [])
batches += [{"name": item["suite"], "identifiers": ["ReylumiTests/" + item["suite"]]}
            for item in suites if item["isolatedHost"]]
expected = [item["suite"] + "/" + method for item in suites for method in item["methods"]]
assert len(expected) == len(set(expected)), "Duplicate XCTest identifier"
(run / "TestInventory.json").write_text(json.dumps({"suites": suites, "batches": batches,
                                                  "expectedCases": sorted(expected)}, indent=2))
(run / "TestBatches.tsv").write_text("".join(item["name"] + "\t" + "\t".join(item["identifiers"]) + "\n" for item in batches))
print("Frozen runtime test inventory:", len(expected), "cases in", len(batches), "host invocations")
PY
: > build/test.log
task_batch_index=0
while IFS=$'\t' read -r task_batch_name task_batch_identifiers; do
  if [[ "$task_batch_index" -gt 0 ]]; then
    # Only the app in this job's selected Simulator is terminated. A host that
    # XCTest already exited is harmless; any other termination error is fatal.
    python3 - "$task_simulator_id" <<'PY'
import subprocess, sys
result = subprocess.run(["xcrun", "simctl", "terminate", sys.argv[1], "com.reylumi.ios"], capture_output=True, text=True)
message = (result.stdout + result.stderr).lower()
already_exited = result.returncode == 3 and ("found nothing to terminate" in message or "no such process" in message)
if result.returncode and not already_exited:
    sys.exit("Cannot establish fresh Simulator test host: " + message)
PY
  fi
  task_batch_index=$((task_batch_index + 1))
  IFS=$'\t' read -r -a task_test_identifiers <<< "$task_batch_identifiers"
  task_only_testing=()
  for task_test_identifier in "${task_test_identifiers[@]}"; do
    task_only_testing+=("-only-testing:$task_test_identifier")
  done
  echo "Runtime test host $task_batch_index: $task_batch_name" | tee -a build/test.log
  xcodebuild test-without-building \
    -project Reylumi.xcodeproj -scheme Reylumi -configuration Debug \
    -destination "platform=iOS Simulator,id=$task_simulator_id" \
    -derivedDataPath "$task_run_dir/DerivedData" \
    -resultBundlePath "$task_run_dir/SimulatorTests-$task_batch_name.xcresult" \
    -collect-test-diagnostics never \
    "${task_only_testing[@]}" "${task_simulator_signing[@]}" 2>&1 | tee -a build/test.log
done < "$task_run_dir/TestBatches.tsv"

# A successful empty -only-testing selection must never pass the release gate.
# Require every source test to start and pass exactly once, with no extra case,
# skip, failure, duplicate, or missing successful host invocation.
python3 - "$task_run_dir" <<'PY'
import collections, hashlib, json, pathlib, re, sys
run = pathlib.Path(sys.argv[1])
inventory = json.loads((run / "TestInventory.json").read_text())
log = pathlib.Path("build/test.log").read_text()
expected = set(inventory["expectedCases"])
started = [suite + "/" + method for suite, method in re.findall(r"Test Case '-\[ReylumiTests\.(\w+) (test\w+)\]' started\.", log)]
passed = [suite + "/" + method for suite, method in re.findall(r"Test Case '-\[ReylumiTests\.(\w+) (test\w+)\]' passed \(", log)]
assert set(started) == expected and len(started) == len(expected), "Missing, duplicate or unexpected started test"
assert set(passed) == expected and len(passed) == len(expected), "Missing, duplicate, skipped or failed test"
assert not re.search(r"Test Case .* (?:failed|skipped)|\*\* TEST EXECUTE FAILED \*\*", log), "Runtime test failure or skip"
assert log.count("** TEST EXECUTE SUCCEEDED **") == len(inventory["batches"]), "Missing successful host invocation"
receipt = {"strategy": "sequential isolated UIKit/WebKit hosts; no persistent data erasure",
           "expectedCases": sorted(expected), "passedCases": sorted(passed),
           "expectedCount": len(expected), "passedCount": len(passed), "failureCount": 0,
           "hostInvocations": len(inventory["batches"]), "coverageVerified": True,
           "caseInventorySha256": hashlib.sha256(json.dumps(sorted(expected)).encode()).hexdigest()}
pathlib.Path("build/test-execution-receipt.json").write_text(json.dumps(receipt, indent=2))
print("Exact runtime coverage verified:", len(passed), "tests; no omissions, duplicates, skips or failures")
PY

xcodebuild archive \
  -project Reylumi.xcodeproj -scheme Reylumi -configuration Release \
  -destination 'generic/platform=iOS' \
  -archivePath "$task_run_dir/Reylumi-unsigned.xcarchive" \
  -derivedDataPath "$task_run_dir/DerivedData" \
  CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/archive.log

# Confirm that the bridge is actually bundled, rather than testing JS source alone.
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/NativeBridge.js"
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/AppViewport.js"
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/AppLocalBridge.js"
test -f "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/LocalAppBundle/manifest.json"
verify_local_package "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/LocalAppBundle"
node ../scripts/ios/local-bundle-release.mjs verify "$task_run_dir/Reylumi-unsigned.xcarchive/Products/Applications/Reylumi.app/LocalAppBundle"
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
    "testExecution": json.loads((root / "build/test-execution-receipt.json").read_text()),
}
(root / "build/build-receipt.json").write_text(json.dumps(receipt, indent=2), encoding="utf-8")
PY
echo "Simulator tests and unsigned device archive passed. Signing is still required for TestFlight."
