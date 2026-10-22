#!/usr/bin/env bash
# One synthetic A/B diagnostic. Never a release gate or archive/upload entry point.
set -euo pipefail
cd "$(dirname "$0")/../.."
python3 - <<'PY'
import hashlib, io, json, os, pathlib, plistlib, re, shutil, subprocess, sys, tarfile, time, traceback

ROOT = pathlib.Path.cwd()
BASE = 'dd32ecb225c1106043ee551f4b658fddf24dc3ea'
BRANCH = 'refs/heads/codex/reylumi-cookie-lifecycle-diagnostic-20261022'
JOURNAL = 'releases/changes/2026-10-22T19-16-39-823Z-6cc2c2b8-dbc3-4030-abe5-fd6cc921bbdc.json'
JOURNAL_SHA256 = 'c45e34cce219736d9f7b37da557144eeef30f497477f9e250a65a3c7308d1f63'
MATCH = 'ReylumiTests/BackgroundCookieAuthorityWKTests/testBackgroundContextDeletionRemovesTheActualStoredParentDomainCookie'
CLASSES = ['BackgroundCookieAuthorityWKTests', 'NativeCookieAuthorityWKTests']
PINS = {
    'BackgroundCookieAuthorityWKTests.swift': 'f6889c26c36fb8b62bc9a83e20514486beb54a4fed32b85cb02af961976f86f2',
    'NativeCookieAuthorityWKTests.swift': '84a99bbb34e5339c492bac30e9a5fad0ca64415ab7413c8f654d05624410c80e',
    'IsolatedWKCookieProfileOwner.swift': '2713eea2b79a1155f751318dff3973cbeb1e571a827680c416f4ed13612ec783',
}
assert os.environ.get('GITHUB_ACTIONS') == 'true' and os.environ.get('RUNNER_OS') == 'macOS', 'GitHub hosted macOS only'
assert os.environ.get('GITHUB_REPOSITORY', '').lower() == 'nypro6895/kingpos'
assert os.environ.get('GITHUB_REF') == BRANCH, 'Diagnostic branch only'
assert os.environ.get('DEVELOPER_DIR') == '/Applications/Xcode_26.3.app/Contents/Developer'
OUT = ROOT / 'ios/build/cookie-lifecycle-diagnostic'
OUT.mkdir(parents=True, exist_ok=False)
report = {'nativeBaseline': BASE, 'workflowSHA': os.environ['GITHUB_SHA'], 'githubRun': os.environ['GITHUB_RUN_ID'],
          'scope': 'synthetic cookie fixture diagnostic only; no archive, release upload, real backend or new login',
          'order': ['A-matched', 'B-matched', 'B-cookie-suites if B-matched passes'],
          'limitations': ['A runs first; shared Simulator runtime has an order/warm-up confound',
                         'One A/B pair cannot prove root cause; non-reproducing A is inconclusive',
                         'B changes warming, foreground ownership and lifetime together; retention alone is not isolated',
                         'Signing check is not the separate runtime own-Keychain XCTest',
                         'At most 14 executions, 12 unique existing cases; not the full 205-test gate'],
          'payloadSHA256': PINS, 'commands': [], 'tests': {}}

def save():
    (OUT / 'receipt.json').write_text(json.dumps(report, indent=2) + '\n')

def run(label, args, cwd=ROOT, required=True):
    started = time.monotonic()
    row = {'phase': label, 'argv': [str(x) for x in args], 'cwd': str(cwd), 'startedUTC': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())}
    report['commands'].append(row); save()
    with (OUT / (label + '.log')).open('w') as log:
        process = subprocess.Popen([str(x) for x in args], cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
        for line in process.stdout:
            log.write(line); log.flush(); print(line, end='', flush=True)
        row['exitCode'] = process.wait()
    row['elapsedSeconds'] = round(time.monotonic() - started, 3); save()
    if required and row['exitCode'] != 0:
        raise RuntimeError(label + ' failed, see retained log')
    return row['exitCode']

def capture(args, cwd=ROOT):
    return subprocess.check_output([str(x) for x in args], cwd=cwd)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def verify_bundle(path):
    manifest = json.loads((path / 'manifest.json').read_bytes())
    for item in manifest['files']:
        resource = path / item['path']
        assert resource.is_file() and resource.stat().st_size == item['bytes'] and sha(resource) == item['sha256'], item['path']
    return manifest['buildId']

def fresh_host(label, simulator):
    # Only the ephemeral hosted runner's selected Simulator app; never a user QA device/profile.
    def probe():
        result = subprocess.run(['xcrun', 'simctl', 'get_app_container', simulator, 'com.reylumi.ios', 'app'], text=True, capture_output=True)
        report.setdefault('hostProbes', []).append({'phase': label, 'exitCode': result.returncode, 'stdout': result.stdout.strip(), 'stderr': result.stderr.strip()}); save()
        if result.returncode == 0:
            path = pathlib.Path(result.stdout.strip())
            assert '/CoreSimulator/Devices/' + simulator + '/data/Containers/Bundle/Application/' in str(path)
            assert plistlib.loads((path / 'Info.plist').read_bytes())['CFBundleIdentifier'] == 'com.reylumi.ios'
            return True
        assert 'NSPOSIXErrorDomain, code=2' in result.stderr and 'No such file or directory' in result.stderr, 'Unproven host absence; inspect probe receipt'
        return False
    present = probe()
    if label == 'A-matched': assert not present, 'Fresh hosted Simulator unexpectedly already has the app'
    if present:
        assert any(x in report['tests'] for x in ['A-matched', 'B-matched']), 'Cannot remove a host not launched by this diagnostic'
        run(label + '-uninstall-old-test-host', ['xcrun', 'simctl', 'uninstall', simulator, 'com.reylumi.ios'])
        assert not probe()
    report.setdefault('freshHostChecks', []).append({'phase': label, 'bundleID': 'com.reylumi.ios', 'absentBeforeTest': True}); save()

def verify_host(app, derived, label):
    assert verify_bundle(app / 'LocalAppBundle') == report['bundleBuildId']
    assert (app / 'AppLocalBridge.js').is_file()
    run(label + '-codesign', ['codesign', '--verify', '--deep', '--strict', app])
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    load = capture(['xcrun', 'otool', '-l', app / info['CFBundleExecutable']]).decode()
    (OUT / (label + '-load-commands.txt')).write_text(load)
    sections, current = [], None
    for line in load.splitlines():
        if line.strip() == 'Section' or line.strip().startswith('Load command '):
            if current: sections.append(current)
            current = None
            continue
        fields = line.strip().split(None, 1)
        if len(fields) != 2: continue
        key, value = fields
        if key == 'sectname':
            if current: sections.append(current)
            current = {key: value}
        elif current is not None and key in ('segname', 'offset', 'size'): current[key] = value
    if current: sections.append(current)
    matches = [x for x in sections if x.get('sectname') == '__entitlements' and x.get('segname') == '__TEXT']
    assert len(matches) == 1
    section = matches[0]; offset, size = int(section['offset'], 0), int(section['size'], 0)
    binary = (app / info['CFBundleExecutable']).read_bytes()
    assert size > 0 and offset >= 0 and offset + size <= len(binary)
    entitlements = plistlib.loads(binary[offset:offset+size].rstrip(b'\0'))
    packaged = list((derived / 'Build/Intermediates.noindex').rglob('Reylumi.app-Simulated.xcent'))
    assert len(packaged) == 1 and plistlib.loads(packaged[0].read_bytes()) == entitlements
    team = entitlements.get('com.apple.developer.team-identifier', '')
    assert re.fullmatch(r'[A-Z0-9]{10}', team)
    identifier = team + '.' + info['CFBundleIdentifier']
    assert info['CFBundleIdentifier'] == 'com.reylumi.ios'
    assert entitlements.get('application-identifier') == identifier and entitlements.get('keychain-access-groups') == [identifier]
    (OUT / (label + '-entitlements.plist')).write_bytes(plistlib.dumps(entitlements))
    test_binary = app / 'PlugIns/ReylumiTests.xctest/ReylumiTests'
    assert test_binary.is_file() and test_binary.stat().st_size > 0, 'Actual compiled test binary missing'
    report.setdefault('builtHosts', {})[label] = {'executableSHA256': hashlib.sha256(binary).hexdigest(),
        'testBinarySHA256': sha(test_binary), 'testBinaryBytes': test_binary.stat().st_size}
    if label == 'B' and 'A' in report['builtHosts']:
        assert report['builtHosts']['A']['testBinarySHA256'] != sha(test_binary), 'B must compile different fixture bytes'
    save()

def test(label, ios, derived, simulator, selection, expected):
    fresh_host(label, simulator)
    args = ['xcodebuild', 'test-without-building', '-project', 'Reylumi.xcodeproj', '-scheme', 'Reylumi', '-configuration', 'Debug',
            '-destination', 'platform=iOS Simulator,id=' + simulator, '-derivedDataPath', derived,
            '-resultBundlePath', OUT / (label + '.xcresult')]
    args += ['-only-testing:' + name for name in selection]
    args += ['CODE_SIGNING_ALLOWED=YES', 'CODE_SIGNING_REQUIRED=YES', 'CODE_SIGN_STYLE=Manual', 'CODE_SIGN_IDENTITY=-',
             'CODE_SIGN_ENTITLEMENTS=' + str(ios / 'ReylumiTests/Simulator.entitlements')]
    rc = run(label, args, cwd=ios, required=False)
    log = (OUT / (label + '.log')).read_text()
    starts = re.findall(r"Test Case '-\[ReylumiTests\.([^ ]+) ([^\]]+)\]' started\.", log)
    finished = re.findall(r"Test Case '-\[ReylumiTests\.([^ ]+) ([^\]]+)\]' (passed|failed|skipped) \(([0-9.]+) seconds\)\.", log)
    names = ['ReylumiTests/' + c + '/' + m for c, m in starts]
    cases = [{'identifier': 'ReylumiTests/' + c + '/' + m, 'status': status, 'durationSeconds': float(seconds)} for c, m, status, seconds in finished]
    exact = sorted(names) == sorted(expected) and sorted(x['identifier'] for x in cases) == sorted(expected)
    passed = rc == 0 and exact and all(x['status'] == 'passed' for x in cases)
    report['tests'][label] = {'exitCode': rc, 'expected': expected, 'starts': names, 'cases': cases,
                            'exactExpectedOnce': exact, 'passed': passed, 'retryRestartLines': [x for x in log.splitlines() if re.search(r'retry|restarting', x, re.I)]}
    save()
    return passed

try:
    assert capture(['git', 'rev-parse', 'HEAD']).decode().strip() == report['workflowSHA']
    run('baseline-ancestry', ['git', 'merge-base', '--is-ancestor', BASE, 'HEAD'])
    allowed = {'.github/workflows/reylumi-ios-check.yml', 'ios/scripts/diagnose-cookie-lifecycle.sh', JOURNAL}
    assert sha(ROOT / JOURNAL) == JOURNAL_SHA256, 'Root working journal differs from reviewed bytes'
    allowed.update('ios/diagnostics/cookie-lifecycle/' + x for x in PINS)
    changed = capture(['git', 'diff', '--name-only', BASE, 'HEAD']).decode().splitlines()
    assert set(changed) <= allowed, 'Unexpected diagnostic branch source changes: ' + str(set(changed) - allowed)
    report['diagnosticCommitChangedPaths'] = changed
    for name, digest in PINS.items(): assert sha(ROOT / 'ios/diagnostics/cookie-lifecycle' / name) == digest, name
    run('bundle-verify', ['node', 'scripts/ios/local-bundle-release.mjs', 'verify'])
    report['bundleBuildId'] = verify_bundle(ROOT / 'ios/Reylumi/LocalAppBundle')
    shutil.copy2(ROOT / 'ios/build/local-bundle-provenance.json', OUT / 'local-bundle-provenance.json')
    run('xcode-version', ['xcodebuild', '-version'])
    devices = json.loads(capture(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))['devices']
    runtime, device = next((runtime, item) for runtime, entries in devices.items() if '.iOS-' in runtime
                           for item in entries if item.get('isAvailable') and item['name'].startswith('iPhone'))
    simulator = device['udid']; report['simulator'] = {'runtime': runtime, **device}; save()
    if device['state'] == 'Shutdown': run('simulator-boot', ['xcrun', 'simctl', 'boot', simulator])
    run('simulator-ready', ['xcrun', 'simctl', 'bootstatus', simulator, '-b'])
    archive = capture(['git', 'archive', '--format=tar', BASE, 'ios'])
    tree = {}
    for row in capture(['git', 'ls-tree', '-r', '-z', BASE, '--', 'ios']).split(b'\0'):
        if not row: continue
        metadata, path = row.split(b'\t', 1)
        mode, kind, blob = metadata.decode().split()
        assert kind == 'blob' and mode in ('100644', '100755')
        tree[path.decode()] = blob
    with tarfile.open(fileobj=io.BytesIO(archive)) as packet:
        assert {x.name for x in packet.getmembers() if x.isfile()} == set(tree), 'Exported baseline tree differs from dd32'
        for item in packet.getmembers():
            if not item.isfile(): continue
            data = packet.extractfile(item).read()
            assert hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest() == tree[item.name], item.name
    report['baselineGitBlobCount'] = len(tree); save()
    baseline_hashes = {}
    variants = {}
    for variant in ['A', 'B']:
        directory = OUT / ('source-' + variant); directory.mkdir()
        with tarfile.open(fileobj=io.BytesIO(archive)) as packet:
            assert all(x.isfile() or x.isdir() for x in packet.getmembers()), 'Unexpected baseline symlink'
            assert all(not pathlib.PurePosixPath(x.name).is_absolute() and '..' not in pathlib.PurePosixPath(x.name).parts for x in packet.getmembers())
            packet.extractall(directory)
        ios = directory / 'ios'; variants[variant] = ios
        hashes = {str(p.relative_to(ios)): sha(p) for p in sorted(ios.rglob('*')) if p.is_file() and 'Reylumi/LocalAppBundle/' not in str(p.relative_to(ios))}
        if variant == 'A': baseline_hashes = hashes
        else: assert hashes == baseline_hashes
        # Rebuilt package is identical across variants; original native sources stay pinned to dd32.
        bundle_destination = ios / 'Reylumi/LocalAppBundle'
        assert bundle_destination.resolve().is_relative_to(OUT.resolve())
        shutil.rmtree(bundle_destination)
        shutil.copytree(ROOT / 'ios/Reylumi/LocalAppBundle', bundle_destination)
        if variant == 'B':
            for name, digest in PINS.items():
                target = ios / 'ReylumiTests' / name
                shutil.copy2(ROOT / 'ios/diagnostics/cookie-lifecycle' / name, target)
                assert sha(target) == digest
        actual = {str(p.relative_to(ios)): sha(p) for p in sorted(ios.rglob('*')) if p.is_file() and 'Reylumi/LocalAppBundle/' not in str(p.relative_to(ios))}
        expected = dict(baseline_hashes)
        if variant == 'B': expected.update({'ReylumiTests/' + name: digest for name, digest in PINS.items()})
        assert actual == expected
        (OUT / ('source-' + variant + '-hashes.json')).write_text(json.dumps(actual, indent=2) + '\n')
    expected_cases = ['ReylumiTests/' + cls + '/' + method for cls in CLASSES
                      for method in re.findall(r'\bfunc (test\w+)\(', (variants['A'] / 'ReylumiTests' / (cls + '.swift')).read_text())]
    assert len(expected_cases) == len(set(expected_cases)) == 12 and MATCH in expected_cases
    for variant in ['A', 'B']:
        ios = variants[variant]; derived = OUT / ('DerivedData-' + variant)
        run(variant + '-generate', ['xcodegen', 'generate'], cwd=ios)
        build_rc = run(variant + '-build', ['xcodebuild', 'build-for-testing', '-project', 'Reylumi.xcodeproj', '-scheme', 'Reylumi', '-configuration', 'Debug',
            '-destination', 'platform=iOS Simulator,id=' + simulator, '-derivedDataPath', derived,
            'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGNING_REQUIRED=YES', 'CODE_SIGN_STYLE=Manual', 'CODE_SIGN_IDENTITY=-',
            'CODE_SIGN_ENTITLEMENTS=' + str(ios / 'ReylumiTests/Simulator.entitlements')], cwd=ios, required=False)
        if build_rc != 0:
            report['tests'][variant + '-matched'] = {'passed': False, 'notRun': 'build-for-testing failed'}; save(); continue
        verify_host(derived / 'Build/Products/Debug-iphonesimulator/Reylumi.app', derived, variant)
        passed = test(variant + '-matched', ios, derived, simulator, [MATCH], [MATCH])
        if variant == 'B' and passed:
            test('B-cookie-suites', ios, derived, simulator, ['ReylumiTests/' + cls for cls in CLASSES], expected_cases)
    report['tests'].setdefault('B-cookie-suites', {'passed': False, 'notRun': 'B matched-case prerequisite did not pass'})
    report['interpretation'] = ('A did not reproduce the failure: causal comparison inconclusive' if report['tests'].get('A-matched', {}).get('passed')
                                else 'A did not pass: inspect original assertions and logs before attributing any B difference')
    report['diagnosticCompleted'] = True
    # A failure is expected evidence, not a failed release reinterpreted as pass.
    report['bSelectionPassed'] = all(report['tests'].get(x, {}).get('passed') for x in ['B-matched', 'B-cookie-suites'])
    executed = [case for phase in report['tests'].values() for case in phase.get('cases', [])]
    report['actualCounts'] = {'caseExecutions': len(executed), 'uniqueCases': len({x['identifier'] for x in executed}),
                             'passedExecutions': sum(x['status'] == 'passed' for x in executed),
                             'failedExecutions': sum(x['status'] == 'failed' for x in executed),
                             'skippedExecutions': sum(x['status'] == 'skipped' for x in executed)}
    save()
    print(json.dumps({'diagnosticOnly': True, 'actualCounts': report['actualCounts'], 'bSelectionPassed': report['bSelectionPassed'],
                      'interpretation': report['interpretation']}, indent=2))
    sys.exit(0 if report['bSelectionPassed'] else 1)
except Exception:
    report['diagnosticCompleted'] = False; report['error'] = traceback.format_exc(); save()
    raise
PY
