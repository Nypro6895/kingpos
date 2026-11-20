#!/usr/bin/env python3
"""Read measured bundle privacy declarations; never an Apple privacy attestation."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import stat
import subprocess
import sys
from xml.etree import ElementTree

MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_ENTRIES = 40000
MAX_DEPTH = 32
BUNDLE_SUFFIXES = {'.app', '.framework', '.bundle', '.appex', '.xpc', '.plugin'}
PUBLIC_INFO_KEYS = ('CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion',
                    'CFBundleName', 'CFBundlePackageType')
PRIVACY_KEYS = ('NSPrivacyTracking', 'NSPrivacyTrackingDomains',
                'NSPrivacyCollectedDataTypes', 'NSPrivacyAccessedAPITypes')
CONFIDENTIAL_DIRS = {'_codesignature', 'private_keys', 'signing', 'keychains', 'documents',
                     'userdata', 'user-data', 'library', 'caches', 'tmp', 'cookies',
                     'indexeddb', 'local storage', 'application support', 'data', 'storage',
                     'sessions', 'accounts', 'preferences'}
CONFIDENTIAL_SUFFIXES = {'.mobileprovision', '.provisionprofile', '.p12', '.p8', '.pem',
                         '.key', '.cer', '.der', '.keychain', '.keychain-db'}
XML_TAGS = {'plist', 'dict', 'key', 'array', 'string', 'integer', 'real', 'true', 'false',
            'date', 'data'}


class InventoryError(Exception):
    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


class UniqueDict(dict):
    def __setitem__(self, key, value):
        if key in self:
            raise InventoryError('duplicate-plist-key')
        super().__setitem__(key, value)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def confidential(name: str) -> bool:
    lower = name.lower()
    return (lower in CONFIDENTIAL_DIRS or lower.startswith('.env')
            or Path(lower).suffix in CONFIDENTIAL_SUFFIXES
            or lower in {'coderesources', 'embedded.mobileprovision'})


def reparse(info) -> bool:
    return stat.S_ISLNK(info.st_mode) or bool(getattr(info, 'st_file_attributes', 0) & 0x400)


def no_link_ancestors(path: Path):
    for item in (path, *path.parents):
        try:
            if reparse(item.lstat()):
                raise InventoryError('symlink-or-reparse-input')
        except FileNotFoundError:
            raise InventoryError('input-missing') from None


def read_public_plist(path: Path, root: Path) -> bytes:
    """Allowlisted leaf, bounded regular file, no-follow where the OS supports it."""
    if path.name != 'Info.plist' and path.suffix != '.xcprivacy':
        raise InventoryError('non-public-file-read-refused')
    try:
        path.relative_to(root)
    except ValueError:
        raise InventoryError('file-outside-bundle') from None
    no_link_ancestors(path)
    before = path.lstat()
    if (not stat.S_ISREG(before.st_mode) or before.st_nlink != 1
            or before.st_size <= 0 or before.st_size > MAX_FILE_BYTES):
        raise InventoryError('unsupported-plist-file')
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
    fd = os.open(path, flags)
    try:
        opened = os.fstat(fd)
        if (not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino)):
            raise InventoryError('plist-identity-changed')
        data = bytearray()
        while len(data) <= MAX_FILE_BYTES:
            block = os.read(fd, min(65536, MAX_FILE_BYTES + 1 - len(data)))
            if not block:
                break
            data.extend(block)
        after = os.fstat(fd)
        if (len(data) > MAX_FILE_BYTES or after.st_size != len(data)
                or (opened.st_size, opened.st_mtime_ns) != (after.st_size, after.st_mtime_ns)):
            raise InventoryError('plist-changed-or-too-large')
        final = path.lstat()
        if reparse(final) or (final.st_dev, final.st_ino) != (opened.st_dev, opened.st_ino):
            raise InventoryError('plist-identity-changed')
        return bytes(data)
    finally:
        os.close(fd)


def parse_plist(data: bytes):
    try:
        if not data.startswith(b'bplist00'):
            if b'<!ENTITY' in data.upper():
                raise InventoryError('xml-entity-refused')
            tree = ElementTree.fromstring(data)
            if tree.tag != 'plist' or any(node.tag not in XML_TAGS for node in tree.iter()):
                raise InventoryError('unknown-plist-xml-element')
            pending = [(tree, 0)]
            nodes = 0
            while pending:
                node, depth = pending.pop()
                nodes += 1
                if depth > 32 or nodes > 20000:
                    raise InventoryError('plist-structure-limit')
                pending.extend((child, depth + 1) for child in node)
        value = plistlib.loads(data, dict_type=UniqueDict)
        if not isinstance(value, dict):
            raise InventoryError('plist-root-not-dictionary')
        return value
    except InventoryError:
        raise
    except (ValueError, TypeError, OverflowError, RecursionError, ElementTree.ParseError, plistlib.InvalidFileException):
        raise InventoryError('invalid-plist') from None


def string(value, pattern=None):
    return (isinstance(value, str) and 0 < len(value) <= 4096
            and (pattern is None or re.fullmatch(pattern, value) is not None))


def strings(value, pattern=None):
    return (isinstance(value, list) and len(value) <= 1000
            and all(string(item, pattern) for item in value))


def manifest_claims(value: dict):
    errors = []
    claims = {key: value[key] for key in PRIVACY_KEYS if key in value}
    if 'NSPrivacyTracking' in value and type(value['NSPrivacyTracking']) is not bool:
        errors.append('NSPrivacyTracking:expected-boolean')
    if 'NSPrivacyTrackingDomains' in value and not strings(
            value['NSPrivacyTrackingDomains'], r'[A-Za-z0-9.-]+'):
        errors.append('NSPrivacyTrackingDomains:expected-domain-array')
    specifications = [
        ('NSPrivacyCollectedDataTypes', {
            'NSPrivacyCollectedDataType': lambda v: string(v, r'NSPrivacyCollectedDataType[A-Za-z0-9]+'),
            'NSPrivacyCollectedDataTypeLinked': lambda v: type(v) is bool,
            'NSPrivacyCollectedDataTypeTracking': lambda v: type(v) is bool,
            'NSPrivacyCollectedDataTypePurposes': lambda v: strings(v, r'NSPrivacyCollectedDataTypePurpose[A-Za-z0-9]+'),
        }),
        ('NSPrivacyAccessedAPITypes', {
            'NSPrivacyAccessedAPIType': lambda v: string(v, r'NSPrivacyAccessedAPICategory[A-Za-z0-9]+'),
            'NSPrivacyAccessedAPITypeReasons': lambda v: strings(v, r'[A-Z0-9]{4}\.[0-9]+'),
        }),
    ]
    for key, fields in specifications:
        if key not in value:
            continue
        entries = value[key]
        if not isinstance(entries, list) or len(entries) > 1000:
            errors.append(key + ':expected-array')
            continue
        for entry in entries:
            if (not isinstance(entry, dict) or set(entry) != set(fields)
                    or any(not check(entry.get(name)) for name, check in fields.items())):
                errors.append(key + ':invalid-entry-shape')
                break
    unknown = len(set(value) - set(PRIVACY_KEYS))
    if unknown:
        errors.append('unknown-privacy-manifest-keys')
    return (claims if not errors else None), errors


def bundle_inventory(app: Path, kind: str, source_commit: str, use_plutil=False):
    app = app.absolute()
    no_link_ancestors(app)
    if app.suffix != '.app' or not app.is_dir():
        raise InventoryError('app-directory-required')
    bundles = {'.': {'path': '.', 'kind': 'app', 'info': None, 'infoSha256': None}}
    manifests, errors, links = [], [], []
    skipped = {'confidentialNames': 0, 'otherFilesNotOpened': 0}
    visited = 0
    stack = [(app, '.', 0)]
    while stack:
        directory, owner, depth = stack.pop()
        if depth > MAX_DEPTH:
            raise InventoryError('bundle-depth-limit')
        with os.scandir(directory) as entries:
            for entry in sorted(entries, key=lambda item: item.name):
                visited += 1
                if visited > MAX_ENTRIES:
                    raise InventoryError('bundle-entry-limit')
                path = Path(entry.path)
                relative = path.relative_to(app).as_posix()
                if confidential(entry.name):
                    skipped['confidentialNames'] += 1
                    continue
                info = entry.stat(follow_symlinks=False)
                if reparse(info):
                    links.append({'path': relative, 'action': 'not-followed'})
                    errors.append({'path': relative, 'code': 'symlink-or-reparse-not-followed'})
                    continue
                if stat.S_ISDIR(info.st_mode):
                    next_owner = owner
                    if path.suffix in BUNDLE_SUFFIXES:
                        next_owner = relative
                        bundles[next_owner] = {'path': next_owner, 'kind': path.suffix[1:],
                                               'info': None, 'infoSha256': None}
                    stack.append((path, next_owner, depth + 1))
                    continue
                is_info = entry.name == 'Info.plist' and directory == (app if owner == '.' else app / owner)
                is_manifest = path.suffix == '.xcprivacy'
                if not is_info and not is_manifest:
                    skipped['otherFilesNotOpened'] += 1
                    continue
                row = {'path': relative, 'associatedBundlePath': owner}
                try:
                    data = read_public_plist(path, app)
                    if is_manifest:
                        row.update(sha256=digest(data), plistFormat='binary' if data.startswith(b'bplist00') else 'xml')
                    parsed = parse_plist(data)
                    if is_info:
                        public = {key: parsed[key] for key in PUBLIC_INFO_KEYS if string(parsed.get(key))}
                        purposes = {key: value for key, value in parsed.items()
                                    if isinstance(key, str) and re.fullmatch(r'NS[A-Za-z0-9]+UsageDescription', key)
                                    and string(value)}
                        bundles[owner].update(info=public, infoSha256=digest(data), purposeStrings=purposes)
                    else:
                        claims, issues = manifest_claims(parsed)
                        row.update(sha256=digest(data), plistFormat='binary' if data.startswith(b'bplist00') else 'xml',
                                   declaredClaims=claims, declarationAuthority='bundle-supplied SDK/app claims; behavior unverified',
                                   syntaxValidation='python-plist-parsed', validationErrors=issues,
                                   appleSemanticValidation='not-performed')
                        if use_plutil:
                            # Feed ONLY already allowlisted bytes. No path/secret reopen by plutil.
                            check = subprocess.run(['/usr/bin/plutil', '-lint', '-'], input=data,
                                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15, check=False)
                            row['plutilSyntax'] = 'passed' if check.returncode == 0 else 'failed'
                            if check.returncode:
                                issues.append('plutil-syntax-failed')
                        else:
                            row['plutilSyntax'] = 'not-run-on-this-platform'
                        for issue in issues:
                            errors.append({'path': relative, 'code': issue})
                        if entry.name != 'PrivacyInfo.xcprivacy':
                            row['filenameFinding'] = 'nonstandard-name-review-required'
                        manifests.append(row)
                except (InventoryError, OSError, subprocess.SubprocessError) as exc:
                    code = exc.code if isinstance(exc, InventoryError) else 'metadata-read-or-plutil-failed'
                    errors.append({'path': relative, 'code': code})
                    if is_manifest:
                        row.update(declaredClaims=None, validationErrors=[code], status='unparsed')
                        manifests.append(row)
    for name, bundle in bundles.items():
        bundle['manifestPaths'] = sorted(row['path'] for row in manifests if row['associatedBundlePath'] == name)
        bundle['manifestObservation'] = 'present' if bundle['manifestPaths'] else 'not-observed-no-behavior-inference'
    main = bundles['.']
    if not main['info'] or any(key not in main['info'] for key in PUBLIC_INFO_KEYS[:3]):
        errors.append({'path': 'Info.plist', 'code': 'main-bundle-identity-incomplete'})
    identity = {'sourceCommit': source_commit, 'mainInfoSha256': main['infoSha256'], 'main': main['info'],
                'manifestFiles': sorted((row['path'], row.get('sha256')) for row in manifests)}
    return {'inputKind': kind, 'appName': app.name, 'sourceCommit': source_commit,
            'metadataIdentitySha256': digest(json.dumps(identity, sort_keys=True).encode()),
            'identityMeaning': 'selected public metadata fingerprint; NOT whole archive/binary/signature hash',
            'mainBundle': main, 'bundles': sorted(bundles.values(), key=lambda row: row['path']),
            'privacyManifests': sorted(manifests, key=lambda row: row['path']), 'symlinksNotFollowed': links,
            'skippedWithoutContentRead': skipped, 'errors': errors, 'visitedEntries': visited}


def archive_app(archive: Path) -> Path:
    archive = archive.absolute()
    no_link_ancestors(archive)
    if archive.suffix != '.xcarchive' or not archive.is_dir():
        raise InventoryError('xcarchive-directory-required')
    applications = archive / 'Products' / 'Applications'
    no_link_ancestors(applications)
    apps = []
    with os.scandir(applications) as entries:
        for entry in entries:
            if entry.name.endswith('.app'):
                if reparse(entry.stat(follow_symlinks=False)):
                    raise InventoryError('symlink-or-reparse-app')
                apps.append(Path(entry.path))
    if len(apps) != 1:
        raise InventoryError('exactly-one-archived-app-required')
    return apps[0]


def collect(archive=None, app=None, exported_app=None, source_commit=None, use_plutil=False):
    if not isinstance(source_commit, str) or not re.fullmatch(r'[0-9a-f]{40}', source_commit):
        raise InventoryError('exact-source-commit-required')
    if (archive is None) == (app is None):
        raise InventoryError('one-archive-or-app-input-required')
    items = []
    primary = archive_app(Path(archive)) if archive is not None else Path(app)
    items.append(bundle_inventory(primary, 'xcarchive-app' if archive is not None else 'app', source_commit, use_plutil))
    if exported_app is not None:
        items.append(bundle_inventory(Path(exported_app), 'exported-app', source_commit, use_plutil))
    return {'schemaVersion': 1, 'generatedUtc': dt.datetime.now(dt.timezone.utc).isoformat(),
            'reportKind': 'measured-bundle-manifest-inventory-NOT-Xcode-generated-Privacy-Report',
            'status': 'collected-with-errors' if any(item['errors'] for item in items) else 'collected',
            'sourceCommit': source_commit, 'inputs': items,
            'appWideClassification': {'dataCollection': 'pending-app-wide-review', 'tracking': 'pending-app-wide-review'},
            'limitations': ['SDK/app manifest declarations are not verified runtime behavior or Apple attestation.',
                            'Missing or empty manifests do not mean Data Not Collected or No Tracking.',
                            'Bundle metadata is not an exhaustive SDK/binary/static-library inventory.',
                            'Hosted web/backend/provider facts, required SDK list/reason approval and App Store answers remain pending.'],
            'readPolicy': 'Only xcprivacy and selected public bundle Info.plist; no signing/key/provision/env/userdata contents'}


def write_new(path: Path, value) -> bytes:
    data = (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + '\n').encode('utf-8')
    with path.open('xb') as output:
        output.write(data)
        output.flush()
        os.fsync(output.fileno())
    return data


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--archive', type=Path)
    mode.add_argument('--app', type=Path)
    parser.add_argument('--exported-app', type=Path)
    parser.add_argument('--source-commit', required=True)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--receipt', required=True, type=Path)
    args = parser.parse_args(argv)
    roots = [p.absolute() for p in (args.archive, args.app, args.exported_app) if p is not None]
    outputs = [args.output.absolute(), args.receipt.absolute()]
    if outputs[0] == outputs[1] or any(out == root or root in out.parents for out in outputs for root in roots):
        parser.error('outputs must be distinct and outside input bundles/archives')
    try:
        for out in outputs:
            no_link_ancestors(out.parent)
            if out.exists() or out.is_symlink():
                raise InventoryError('output-already-exists')
        try:
            report = collect(args.archive, args.app, args.exported_app, args.source_commit, sys.platform == 'darwin')
        except (InventoryError, OSError) as exc:
            report = {'schemaVersion': 1, 'reportKind': 'bundle-manifest-inventory-not-attestation',
                      'status': 'collection-failed', 'sourceCommit': args.source_commit if re.fullmatch(r'[0-9a-f]{40}', args.source_commit) else None,
                      'errorCode': exc.code if isinstance(exc, InventoryError) else 'input-unavailable',
                      'appWideClassification': {'dataCollection': 'pending-app-wide-review', 'tracking': 'pending-app-wide-review'}}
        exit_code = 0 if report['status'] == 'collected' else 2
        data = write_new(outputs[0], report)
        write_new(outputs[1], {'schemaVersion': 1, 'status': report['status'], 'exitCode': exit_code,
                              'sourceCommit': args.source_commit, 'inventorySha256': digest(data),
                              'inventoryFilename': outputs[0].name, 'applePrivacyAttestation': False,
                              'inputProvenance': 'caller-provided paths; actual build provenance must be bound by the CI archive/export flow'})
        print(json.dumps({'status': report['status'], 'inventorySha256': digest(data), 'exitCode': exit_code}))
        return exit_code
    except (InventoryError, OSError):
        print('privacy inventory output refused; existing artifacts were not overwritten', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
