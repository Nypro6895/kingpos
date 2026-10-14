#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/store-screenshots
xcodegen generate
xcodebuild build -project Reylumi.xcodeproj -scheme Reylumi -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/screenshot-derived \
  CODE_SIGNING_ALLOWED=NO > build/store-screenshots/build.log 2>&1
python3 scripts/capture-store-screenshots.py
