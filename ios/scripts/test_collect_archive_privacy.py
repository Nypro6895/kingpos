import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import plistlib
import stat
import tempfile
import types
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location('archive_privacy', Path(__file__).with_name('collect-archive-privacy.py'))
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)
COMMIT = 'a' * 40


class InventoryTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='reylumi-privacy-fixture-')
        self.root = Path(self.temp.name)

    def tearDown(self):
        # This is exclusively generated test data; no input/archive path supplied by a user.
        self.assertTrue(self.root.name.startswith('reylumi-privacy-fixture-'))
        self.assertEqual(self.root.absolute(), Path(self.temp.name).absolute())
        self.assertEqual(self.root.parent, Path(tempfile.gettempdir()))
        self.temp.cleanup()

    def plist(self, path, value, fmt=plistlib.FMT_XML):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(plistlib.dumps(value, fmt=fmt))

    def app(self, parent=None, name='Fixture.app'):
        app = (parent or self.root) / name
        app.mkdir(parents=True)
        self.plist(app / 'Info.plist', {
            'CFBundleIdentifier': 'example.fixture', 'CFBundleShortVersionString': '1.2.3',
            'CFBundleVersion': '456', 'CFBundleName': 'Fixture', 'CFBundlePackageType': 'APPL',
            'NSCameraUsageDescription': 'Fixture public camera purpose',
            'DoNotExportThisUnknownValue': 'FAKE_PRIVATE_VALUE',
        })
        return app

    def manifest(self, app, value=None, fmt=plistlib.FMT_XML):
        path = app / 'PrivacyInfo.xcprivacy'
        self.plist(path, value if value is not None else {
            'NSPrivacyTracking': False,
            'NSPrivacyCollectedDataTypes': [],
            'NSPrivacyAccessedAPITypes': [{'NSPrivacyAccessedAPIType': 'NSPrivacyAccessedAPICategoryUserDefaults',
                                          'NSPrivacyAccessedAPITypeReasons': ['CA92.1']}],
        }, fmt)
        return path

    def report(self, app, **kwargs):
        return collector.collect(app=app, source_commit=COMMIT, **kwargs)

    def test_xml_and_binary_sdk_claims_associate_bundle_identity(self):
        app = self.app()
        self.manifest(app)
        sdk = app / 'Frameworks' / 'FixtureSDK.framework'
        self.plist(sdk / 'Info.plist', {'CFBundleIdentifier': 'example.sdk', 'CFBundleVersion': '8'})
        path = self.manifest(sdk, {'NSPrivacyTracking': True, 'NSPrivacyTrackingDomains': ['tracking.example']}, plistlib.FMT_BINARY)
        report = self.report(app)
        self.assertEqual(report['status'], 'collected')
        rows = report['inputs'][0]['privacyManifests']
        binary = next(row for row in rows if row['plistFormat'] == 'binary')
        self.assertEqual(binary['associatedBundlePath'], 'Frameworks/FixtureSDK.framework')
        self.assertEqual(binary['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertTrue(binary['declaredClaims']['NSPrivacyTracking'])
        self.assertEqual(report['appWideClassification']['tracking'], 'pending-app-wide-review')

    def test_public_info_filtered_and_missing_manifest_never_infers_absence(self):
        app = self.app()
        report = self.report(app)
        main = report['inputs'][0]['mainBundle']
        self.assertEqual(main['info']['CFBundleVersion'], '456')
        self.assertIn('NSCameraUsageDescription', main['purposeStrings'])
        self.assertEqual(main['manifestObservation'], 'not-observed-no-behavior-inference')
        self.assertNotIn('FAKE_PRIVATE_VALUE', json.dumps(report))
        self.assertEqual(report['appWideClassification']['dataCollection'], 'pending-app-wide-review')

    def test_malformed_manifest_has_hash_and_truthful_error(self):
        app = self.app()
        path = app / 'PrivacyInfo.xcprivacy'
        path.write_bytes(b'<plist><dict>broken')
        report = self.report(app)
        self.assertEqual(report['status'], 'collected-with-errors')
        row = report['inputs'][0]['privacyManifests'][0]
        self.assertEqual(row['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertIsNone(row['declaredClaims'])

    def test_invalid_schema_unknown_keys_and_boolean_integer_are_not_claims(self):
        app = self.app()
        self.manifest(app, {'NSPrivacyTracking': 0, 'UnknownSecret': 'DO_NOT_EXPORT'})
        report = self.report(app)
        self.assertEqual(report['status'], 'collected-with-errors')
        self.assertIsNone(report['inputs'][0]['privacyManifests'][0]['declaredClaims'])
        self.assertNotIn('DO_NOT_EXPORT', json.dumps(report))

    def test_mac_plutil_receives_allowlisted_bytes_on_stdin_not_a_file_path(self):
        app = self.app()
        path = self.manifest(app)
        with mock.patch.object(collector.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as command:
            report = self.report(app, use_plutil=True)
        self.assertEqual(report['status'], 'collected')
        self.assertEqual(command.call_args.args[0], ['/usr/bin/plutil', '-lint', '-'])
        self.assertEqual(command.call_args.kwargs['input'], path.read_bytes())
        self.assertEqual(report['inputs'][0]['privacyManifests'][0]['plutilSyntax'], 'passed')

    def test_duplicate_and_unknown_xml_and_entity_refused(self):
        cases = [b'<plist><dict><key>x</key><true/><key>x</key><false/></dict></plist>',
                 b'<plist><dict><key>x</key><unknown>value</unknown></dict></plist>',
                 b'<!DOCTYPE plist [<!ENTITY secret "fake">]><plist><dict/></plist>']
        for data in cases:
            with self.subTest(data=data[:16]), self.assertRaises(collector.InventoryError):
                collector.parse_plist(data)

    def test_confidential_signing_env_userdata_and_binaries_never_opened(self):
        app = self.app()
        self.manifest(app)
        for name in ('embedded.mobileprovision', 'certificate.p12', 'AuthKey_fixture.p8', '.env.local', 'Executable'):
            (app / name).write_text('DO_NOT_READ_CONFIDENTIAL')
        for folder in ('_CodeSignature', 'private_keys', 'UserData', 'Documents', 'data'):
            self.plist(app / folder / 'PrivacyInfo.xcprivacy', {'Secret': 'DO_NOT_READ_CONFIDENTIAL'})
        calls = []
        original = collector.read_public_plist
        def observed(path, root):
            calls.append(path.relative_to(app).as_posix())
            return original(path, root)
        with mock.patch.object(collector, 'read_public_plist', side_effect=observed):
            report = self.report(app)
        self.assertEqual(set(calls), {'Info.plist', 'PrivacyInfo.xcprivacy'})
        self.assertNotIn('DO_NOT_READ_CONFIDENTIAL', json.dumps(report))
        self.assertGreater(report['inputs'][0]['skippedWithoutContentRead']['confidentialNames'], 5)

    def test_symlink_not_followed_or_mocked_lstat_guard_when_os_disallows_creation(self):
        app = self.app()
        outside = self.root / 'outside-private.plist'
        outside.write_text('DO_NOT_READ_OUTSIDE')
        link = app / 'PrivacyInfo.xcprivacy'
        try:
            os.symlink(outside, link)
        except (OSError, NotImplementedError):
            original = Path.lstat
            def fake(path):
                return types.SimpleNamespace(st_mode=stat.S_IFLNK, st_file_attributes=0) if path == link else original(path)
            link.write_bytes(b'not-a-manifest')
            with mock.patch.object(Path, 'lstat', fake), mock.patch.object(os, 'open', side_effect=AssertionError('must not open')):
                with self.assertRaisesRegex(collector.InventoryError, 'symlink-or-reparse'):
                    collector.read_public_plist(link, app)
        else:
            with mock.patch.object(collector, 'read_public_plist', wraps=collector.read_public_plist) as reads:
                report = self.report(app)
            self.assertTrue(report['inputs'][0]['symlinksNotFollowed'])
            self.assertNotIn(link, [call.args[0] for call in reads.call_args_list])

    def test_hardlinked_candidate_refused_before_read(self):
        app = self.app()
        outside = self.root / 'not-read'
        outside.write_text('fake private bytes')
        target = app / 'PrivacyInfo.xcprivacy'
        try:
            os.link(outside, target)
        except OSError:
            with mock.patch.object(collector.os, 'open', side_effect=AssertionError('must not open')):
                info = types.SimpleNamespace(st_mode=stat.S_IFREG, st_nlink=2, st_size=10, st_file_attributes=0)
                with mock.patch.object(Path, 'lstat', return_value=info), self.assertRaises(collector.InventoryError):
                    collector.read_public_plist(target, app)
        else:
            with self.assertRaisesRegex(collector.InventoryError, 'unsupported-plist-file'):
                collector.read_public_plist(target, app)

    def test_canonical_known_caller_parent_accepted_but_bundle_link_refused(self):
        parent = self.root / 'known-own-physical-temp'
        app = self.app(parent)
        self.manifest(app)
        # Model caller pwd -P of ONLY its own temp parent; no bundle resolve in collector.
        canonical_app = parent.resolve(strict=True) / app.name
        self.assertEqual(self.report(canonical_app)['status'], 'collected')
        alias = self.root / 'known-own-temp-alias'
        target_link = parent / 'Linked.app'
        try:
            os.symlink(parent, alias, target_is_directory=True)
            os.symlink(app, target_link, target_is_directory=True)
        except (OSError, NotImplementedError):
            original = Path.lstat
            def fake(path):
                return types.SimpleNamespace(st_mode=stat.S_IFLNK, st_file_attributes=0) if path == target_link else original(path)
            with mock.patch.object(Path, 'lstat', fake), self.assertRaises(collector.InventoryError):
                self.report(target_link)
        else:
            with self.assertRaises(collector.InventoryError):
                self.report(alias / app.name)
            self.assertEqual(self.report(alias.resolve(strict=True) / app.name)['status'], 'collected')
            with self.assertRaises(collector.InventoryError):
                self.report(target_link)

    def test_archive_and_exported_app_paths_are_supplied_not_hardcoded(self):
        archive = self.root / 'ArbitraryBuild.xcarchive'
        app = self.app(archive / 'Products' / 'Applications', 'Anything.app')
        self.manifest(app)
        exported = self.app(self.root / 'export', 'Another.app')
        self.manifest(exported)
        report = collector.collect(archive=archive, exported_app=exported, source_commit=COMMIT)
        self.assertEqual([item['inputKind'] for item in report['inputs']], ['xcarchive-app', 'exported-app'])
        self.assertEqual(report['inputs'][0]['mainBundle']['info']['CFBundleIdentifier'], 'example.fixture')
        self.assertIn('NOT whole archive', report['inputs'][0]['identityMeaning'])

    def test_bound_limits_and_non_allowlisted_file_read(self):
        app = self.app()
        with mock.patch.object(collector, 'MAX_ENTRIES', 0), self.assertRaises(collector.InventoryError):
            self.report(app)
        with self.assertRaisesRegex(collector.InventoryError, 'non-public-file-read-refused'):
            collector.read_public_plist(app / 'secret.key', app)

    def test_cli_error_receipt_hash_and_no_overwrite(self):
        app = self.app()
        self.manifest(app, {'NSPrivacyTracking': 'not-a-boolean'})
        output, receipt = self.root / 'inventory.json', self.root / 'receipt.json'
        args = ['--app', str(app), '--source-commit', COMMIT, '--output', str(output), '--receipt', str(receipt)]
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(collector.main(args), 2)
        saved = output.read_bytes()
        self.assertEqual(json.loads(receipt.read_text())['inventorySha256'], hashlib.sha256(saved).hexdigest())
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(collector.main(args), 2)
        self.assertEqual(output.read_bytes(), saved)

    def test_workflow_collector_after_export_before_upload_and_artifacts(self):
        repo = Path(__file__).resolve().parents[2]
        script = (repo / 'ios/scripts/testflight.sh').read_text()
        marker = 'python3 scripts/collect-archive-privacy.py'
        self.assertLess(script.index('xcodebuild -exportArchive'), script.index(marker))
        self.assertLess(script.index('verify "$SIGNING/export-check/Payload/Reylumi.app/LocalAppBundle"'), script.index(marker))
        self.assertLess(script.index(marker), script.index('xcrun altool --upload-app'))
        self.assertIn('PRIVACY_BUILD_ROOT=$(cd "$ROOT/build" && pwd -P)', script)
        self.assertIn('PRIVACY_SIGNING_ROOT=$(cd "$SIGNING" && pwd -P)', script)
        self.assertIn('--archive "$PRIVACY_BUILD_ROOT/Reylumi.xcarchive"', script)
        self.assertIn('--exported-app "$PRIVACY_SIGNING_ROOT/export-check/Payload/Reylumi.app"', script)
        workflow = (repo / '.github/workflows/reylumi-ios-testflight.yml').read_text()
        self.assertIn('ios/build/archive-privacy-inventory.json', workflow)
        self.assertIn('ios/build/archive-privacy-inventory-receipt.json', workflow)


if __name__ == '__main__':
    unittest.main(verbosity=2)
