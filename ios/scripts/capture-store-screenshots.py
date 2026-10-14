"""Capture real simulator pixels from the unchanged app, without injected content."""
import hashlib
import json
import os
import pathlib
import shutil
import subprocess
import time

root = pathlib.Path.cwd()
output = root / 'build/store-screenshots'

def run(*args):
    print('Running: ' + ' '.join(args[:5]), flush=True)
    return subprocess.check_output(args, text=True, timeout=600).strip()

devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
available = [device for runtime, rows in devices.items() if '.iOS-' in runtime for device in rows if device.get('isAvailable')]
selections = [
    ('iphone-63', next((d for d in available if d['name'] in ['iPhone 17 Pro', 'iPhone 16 Pro']), None)),
    ('ipad-13', next((d for d in available if 'iPad Pro 13-inch' in d['name']), None)),
]
if any(device is None for _, device in selections):
    raise RuntimeError('Required iPhone Dynamic Island medium and iPad 13-inch simulators are unavailable: ' + str([d['name'] for d in available]))

app = root / 'build/screenshot-derived/Build/Products/Release-iphonesimulator/Reylumi.app'
receipt = {
    'commit': run('git', 'rev-parse', 'HEAD'),
    'run': os.environ.get('GITHUB_RUN_ID'),
    'source': 'Actual production app, ordinary UI tap to close promotion; no fixture data or page injection',
    'nativeSourceSHA256': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted((root / 'Reylumi').rglob('*')) if p.is_file()},
    'screenshots': [],
}
for label, device in selections:
    udid = device['udid']
    if device['state'] != 'Booted':
        run('xcrun', 'simctl', 'boot', udid)
    run('xcrun', 'simctl', 'bootstatus', udid, '-b')
    run('xcrun', 'simctl', 'ui', udid, 'appearance', 'light')
    run('xcrun', 'simctl', 'status_bar', udid, 'override', '--time', '9:41', '--dataNetwork', 'wifi', '--wifiMode', 'active', '--wifiBars', '3', '--batteryState', 'charged', '--batteryLevel', '100')
    with (output / (label + '-ui-test.log')).open('w', encoding='utf-8') as log:
        subprocess.run(['xcodebuild', 'test-without-building', '-project', 'Reylumi.xcodeproj', '-scheme', 'ReylumiScreenshots', '-configuration', 'Release', '-destination', 'platform=iOS Simulator,id=' + udid, '-derivedDataPath', 'build/screenshot-derived', '-parallel-testing-enabled', 'NO', '-resultBundlePath', str(output / (label + '.xcresult')), 'CODE_SIGNING_ALLOWED=NO'], stdout=log, stderr=subprocess.STDOUT, check=True, timeout=900)
    container = pathlib.Path(run('xcrun', 'simctl', 'get_app_container', udid, 'com.reylumi.ios.screenshots.xctrunner', 'data'))
    image = output / (label + '-explore.jpg')
    shutil.copyfile(container / 'Documents/reylumi-explore.jpg', image)
    receipt['screenshots'].append({'file': image.name, 'device': device['name'], 'sha256': hashlib.sha256(image.read_bytes()).hexdigest()})
    run('xcrun', 'simctl', 'shutdown', udid)
(output / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
