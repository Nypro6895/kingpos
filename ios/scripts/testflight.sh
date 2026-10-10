#!/bin/bash
set -euo pipefail
umask 077
ROOT="$PWD"
SIGNING=$(mktemp -d "$RUNNER_TEMP/reylumi-signing.XXXXXX")
KEYCHAIN="$SIGNING/signing.keychain-db"
KEYCHAIN_PASSWORD=$(openssl rand -hex 24)
PROFILE_PATH=""
PROFILE_LEGACY=""
cleanup() {
  security delete-keychain "$KEYCHAIN" >/dev/null 2>&1 || true
  if [ -n "$PROFILE_PATH" ]; then rm -f "$PROFILE_PATH" "$PROFILE_LEGACY"; fi
  rm -f "$SIGNING/certificate.p12" "$SIGNING/profile.mobileprovision" "$SIGNING/profile.plist" "$SIGNING/private_keys/AuthKey_${APP_STORE_CONNECT_KEY_ID}.p8"
}
trap cleanup EXIT
mkdir -p build "$SIGNING/private_keys"
python3 - "$SIGNING" <<'PY'
import os,base64,pathlib,sys
p=pathlib.Path(sys.argv[1])
(p/'certificate.p12').write_bytes(base64.b64decode(os.environ['IOS_DISTRIBUTION_P12'],validate=True))
(p/'profile.mobileprovision').write_bytes(base64.b64decode(os.environ['IOS_PROVISIONING_PROFILE'],validate=True))
(p/'private_keys'/('AuthKey_'+os.environ['APP_STORE_CONNECT_KEY_ID']+'.p8')).write_text(os.environ['APP_STORE_CONNECT_PRIVATE_KEY'])
PY
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security import "$SIGNING/certificate.p12" -P "$IOS_DISTRIBUTION_PASSWORD" -k "$KEYCHAIN" -T /usr/bin/codesign -T /usr/bin/security
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
security list-keychains -d user -s "$KEYCHAIN" "$HOME/Library/Keychains/login.keychain-db"
security cms -D -i "$SIGNING/profile.mobileprovision" > "$SIGNING/profile.plist"
PROFILE_UUID=$(python3 - "$SIGNING" <<'PY'
import plistlib,pathlib,sys,os,datetime
p=pathlib.Path(sys.argv[1]); profile=plistlib.loads((p/'profile.plist').read_bytes())
team=os.environ['APPLE_TEAM_ID']; bundle='com.reylumi.ios'
assert profile['Entitlements']['application-identifier']==team+'.'+bundle
assert profile['TeamIdentifier']==[team]
assert not profile.get('ProvisionedDevices') and not profile.get('ProvisionsAllDevices')
assert not profile['Entitlements'].get('get-task-allow')
assert profile['ExpirationDate']>datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
options={'method':'app-store-connect','signingStyle':'manual','teamID':team,'signingCertificate':'Apple Distribution','provisioningProfiles':{bundle:profile['UUID']},'manageAppVersionAndBuildNumber':False,'stripSwiftSymbols':True,'destination':'export'}
(p/'ExportOptions.plist').write_bytes(plistlib.dumps(options))
print(profile['UUID'])
PY
)
PROFILE_PATH="$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
PROFILE_LEGACY="$HOME/Library/MobileDevice/Provisioning Profiles/$PROFILE_UUID.mobileprovision"
mkdir -p "$(dirname "$PROFILE_PATH")" "$(dirname "$PROFILE_LEGACY")"
cp "$SIGNING/profile.mobileprovision" "$PROFILE_PATH"
cp "$SIGNING/profile.mobileprovision" "$PROFILE_LEGACY"
BUILD_VERSION="${GITHUB_RUN_NUMBER}.${GITHUB_RUN_ATTEMPT}"
xcodegen generate
xcodebuild archive -project Reylumi.xcodeproj -scheme Reylumi -configuration Release -destination 'generic/platform=iOS' -archivePath "$ROOT/build/Reylumi.xcarchive" -derivedDataPath "$ROOT/build/DerivedData-signed" CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM="$APPLE_TEAM_ID" CODE_SIGN_IDENTITY='Apple Distribution' PROVISIONING_PROFILE_SPECIFIER="$PROFILE_UUID" CURRENT_PROJECT_VERSION="$BUILD_VERSION" 2>&1 | tee build/testflight-archive.log
codesign --verify --deep --strict "$ROOT/build/Reylumi.xcarchive/Products/Applications/Reylumi.app"
xcodebuild -exportArchive -archivePath "$ROOT/build/Reylumi.xcarchive" -exportPath "$ROOT/build/export" -exportOptionsPlist "$SIGNING/ExportOptions.plist" 2>&1 | tee build/testflight-export.log
cd "$SIGNING"
xcrun altool --upload-app --type ios --file "$ROOT/build/export/Reylumi.ipa" --apiKey "$APP_STORE_CONNECT_KEY_ID" --apiIssuer "$APP_STORE_CONNECT_ISSUER_ID" 2>&1 | tee "$ROOT/build/testflight-upload.log"
cd "$ROOT"
python3 - "$BUILD_VERSION" <<'PY'
import json,pathlib,sys,subprocess,hashlib
files={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in pathlib.Path('Reylumi').rglob('*') if p.is_file()}
receipt={'bundle':'com.reylumi.ios','version':'1.0.0','build':sys.argv[1],'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'xcode':subprocess.check_output(['xcodebuild','-version'],text=True).strip(),'upload':'accepted','source_sha256':files}
pathlib.Path('build/testflight-receipt.json').write_text(json.dumps(receipt,indent=2))
PY
