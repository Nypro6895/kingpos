# Measured iOS archive privacy inventory

`ios/scripts/collect-archive-privacy.py` collects privacy manifests and selected public bundle metadata from caller-supplied `.xcarchive` / `.app` build outputs. It is **not** Xcode's generated Privacy Report, an Apple privacy attestation, a binary scanner, or App Store privacy answers.

The existing TestFlight flow runs it after signed archive verification, IPA export/extraction and local-bundle verification, before the one existing upload command. Only known own build/temp **parent roots** are canonicalized by the caller (`pwd -P`) to handle macOS `/var` aliases. Fixed archive/app leaves are appended afterward; actual input/bundle/internal symlinks and reparse points remain refused and outlined without following them. Signing, team, tester/group, credentials, permissions and upload retries are unchanged. This source change does not run or upload anything by itself.

The collector opens only bounded regular single-link `.xcprivacy` files and direct bundle `Info.plist` files. It records manifest SHA256 and parsed SDK/app-declared claims, associated app/framework/resource-bundle IDs/versions, public version/build and usage-purpose strings. It reads no Mach-O/library data, keys, signing/provisioning files, environment files or userdata contents. Confidential directory/name classes are pruned and all other files are counted without opening. The selected metadata fingerprint is explicitly **not a hash of the whole archive/app**; existing build provenance remains its authority.

XML and binary plists are parsed with Python `plistlib`, rejecting duplicate keys, entities, ignored/unknown XML elements, unsupported structure and invalid recognized field types. On macOS `/usr/bin/plutil -lint -` additionally checks syntax using already allowlisted bytes on stdin. Plist parsing/linting does not prove Apple-recognized reason codes, SDK requirements or truthful runtime behavior. Neither SDK `NSPrivacyTracking=false`, empty arrays nor a missing manifest becomes app-wide “No Tracking” / “Data Not Collected”. Global collection/tracking stay pending. Bundles without observed manifests and skipped directories remain unknown; static libraries, hosted web/backend/provider behavior and a complete SDK catalog are outside scope.

The output and hash receipt are `ios/build/archive-privacy-inventory.json` and `ios/build/archive-privacy-inventory-receipt.json`, uploaded by the workflow's existing always-artifact step. Parsed invalid manifests, symlinks, unreadable/unsupported input or missing main app identity produce truthful error output and a nonzero collector exit, stopping before upload via the existing `set -e`. Existing output is never overwritten. Missing optional SDK manifests are recorded for review without asserting whether they are required. A failed inventory does not automatically retry upload or change Apple metadata.

Fixture-only checks:

```sh
python3 -B ios/scripts/test_collect_archive_privacy.py
bash -n ios/scripts/testflight.sh
```

No actual archive collection, Xcode-generated report, signing, provider/device test, TestFlight upload or Store submission is established by fixture tests. The next ordinary authorized archive run will generate measured evidence for that exact source/build; app-wide/legal declarations still require review of all relevant behavior.

Primary references: [Apple privacy manifests](https://developer.apple.com/documentation/bundleresources/privacy-manifest-files), [Apple data-use declarations and Xcode Privacy Report](https://developer.apple.com/documentation/bundleresources/describing-data-use-in-privacy-manifests), [Apple TN3181/plutil limitations](https://developer.apple.com/documentation/technotes/tn3181-debugging-invalid-privacy-manifest), [Python plistlib XML/binary support](https://docs.python.org/3/library/plistlib.html).
