"""Capture real simulator pixels from the unchanged app, without injected content."""
import hashlib
import json
import os
import pathlib
import subprocess
import time

root = pathlib.Path.cwd()
output = root / 'build/store-screenshots'

def run(*args):
    return subprocess.check_output(args, text=True).strip()

devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
available = [device for runtime, rows in devices.items() if '.iOS-' in runtime for device in rows if device.get('isAvailable')]
selections = [
    ('iphone-69', next((d for d in available if d['name'] in ['iPhone 17 Pro Max', 'iPhone 16 Pro Max']), None)),
    ('ipad-13', next((d for d in available if 'iPad Pro 13-inch' in d['name']), None)),
]
if any(device is None for _, device in selections):
    raise RuntimeError('Required iPhone 6.9-inch and iPad 13-inch simulators are unavailable: ' + str([d['name'] for d in available]))

app = root / 'build/screenshot-derived/Build/Products/Release-iphonesimulator/Reylumi.app'
receipt = {
    'commit': run('git', 'rev-parse', 'HEAD'),
    'run': os.environ.get('GITHUB_RUN_ID'),
    'source': 'Actual production app launched normally; no fixture data or page injection',
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
    run('xcrun', 'simctl', 'install', udid, str(app))
    run('xcrun', 'simctl', 'launch', udid, 'com.reylumi.ios')
    time.sleep(45)
    image = output / (label + '-explore.png')
    run('xcrun', 'simctl', 'io', udid, 'screenshot', str(image))
    receipt['screenshots'].append({'file': image.name, 'device': device['name'], 'sha256': hashlib.sha256(image.read_bytes()).hexdigest()})
    run('xcrun', 'simctl', 'shutdown', udid)
(output / 'receipt.json').write_text(json.dumps(receipt, indent=2), encoding='utf-8')
