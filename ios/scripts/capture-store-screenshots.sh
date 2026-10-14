#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/store-screenshots
xcodegen generate --spec screenshot-project.yml
xcodebuild build-for-testing -project Reylumi.xcodeproj -scheme ReylumiScreenshots -configuration Release \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath build/screenshot-derived \
  CODE_SIGNING_ALLOWED=NO > build/store-screenshots/build.log 2>&1
python3 scripts/capture-store-screenshots.py
