#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build
xcodebuild -version
xcodegen generate --spec reload-fixture-project.yml
xcrun simctl list devices available --json > build/devices.json
task_simulator_id="$(python3 - <<'PY'
import json
devices=json.load(open('build/devices.json'))['devices']
for runtime in sorted(devices, reverse=True):
    if '.iOS-' not in runtime: continue
    for device in devices[runtime]:
        if device.get('isAvailable') and device['name'].startswith('iPhone'):
            print(device['udid']); raise SystemExit(0)
raise SystemExit('No iPhone Simulator')
PY
)"
echo "Selected iPhone Simulator: $task_simulator_id"
python3 - "$task_simulator_id" <<'PY'
import subprocess,sys
device=sys.argv[1]
subprocess.run(['xcrun','simctl','boot',device],timeout=60,check=False)
subprocess.run(['xcrun','simctl','bootstatus',device,'-b'],timeout=180,check=True)
PY
xcodebuild build -project ReloadFixture.xcodeproj -scheme ReloadFixture -configuration Debug -destination "platform=iOS Simulator,id=$task_simulator_id" -derivedDataPath build/FixtureDerivedData CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/fixture-build.log
python3 - "$task_simulator_id" <<'PY'
import json,os,pathlib,subprocess,sys,time,uuid
device=sys.argv[1]; bundle='com.reylumi.reloadfixture'
subprocess.run(['xcrun','simctl','install',device,'build/FixtureDerivedData/Build/Products/Debug-iphonesimulator/ReloadFixture.app'],timeout=120,check=True)
container=subprocess.check_output(['xcrun','simctl','get_app_container',device,bundle,'data'],text=True,timeout=30).strip()
result=pathlib.Path(container)/'Documents/result.json'
result.unlink(missing_ok=True)
run_token=str(uuid.uuid4())
launch_env={**os.environ,'SIMCTL_CHILD_RELOAD_FIX_TOKEN':run_token}
subprocess.run(['xcrun','simctl','terminate',device,bundle],timeout=30,check=False)
with open('build/fixture-app.log','w') as log:
    subprocess.run(['xcrun','simctl','launch','--stdout='+str(pathlib.Path('build/fixture-app.log').resolve()),'--stderr='+str(pathlib.Path('build/fixture-app-stderr.log').resolve()),device,bundle],timeout=90,check=True,env=launch_env)
for attempt in range(180):
    if result.exists(): break
    time.sleep(1)
else: raise SystemExit('Simulator fixture did not produce a result within180seconds')
data=json.loads(result.read_text());data['simulator']=device;data['commit']=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()
if data.get('runToken')!=run_token: raise SystemExit('Fixture result does not belong to this launch')
pathlib.Path('build/fixture-result.json').write_text(json.dumps(data,indent=2))
print(json.dumps(data,indent=2))
subprocess.run(['xcrun','simctl','io',device,'screenshot','build/fixture-screen.png'],timeout=30,check=False)
subprocess.run(['xcrun','simctl','terminate',device,bundle],timeout=30,check=False)
if data['status']!='passed': raise SystemExit(1)
PY
# Verify production native source still archives; this is unsigned and never uploaded.
xcodegen generate
xcodebuild archive -project Reylumi.xcodeproj -scheme Reylumi -configuration Release -destination 'generic/platform=iOS' -archivePath build/Reylumi-unsigned.xcarchive -derivedDataPath build/NativeDerivedData CODE_SIGNING_ALLOWED=NO 2>&1 | tee build/archive.log
