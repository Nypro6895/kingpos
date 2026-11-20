param(
    [Parameter(Mandatory=$true)][string]$Serial,
    [string]$ApkPath,
    [string]$SdkPath=$env:ANDROID_HOME
)
$ErrorActionPreference='Stop'
$rootQa=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if(-not $SdkPath){$SdkPath='C:\Reylumi-worktrees\android-ipad-store-20261105\artifacts\toolchain\sdk'}
$adbQa=Join-Path $SdkPath 'platform-tools\adb.exe'
if(-not (Test-Path -LiteralPath $adbQa)){throw 'Android SDK platform-tools/adb.exe not found. Supply -SdkPath.'}
if(-not $ApkPath){$ApkPath=Join-Path $rootQa 'android\app\build\outputs\apk\qa\app-qa.apk'}
$ApkPath=(Resolve-Path -LiteralPath $ApkPath).Path
$aaptQa=Get-ChildItem (Join-Path $SdkPath 'build-tools') -Filter aapt.exe -Recurse | Sort-Object FullName -Descending | Select-Object -First 1
if(-not $aaptQa){throw 'Android SDK aapt.exe not found; cannot verify the APK identity safely.'}
$badgingQa=& $aaptQa.FullName dump badging $ApkPath
if($LASTEXITCODE -ne 0 -or -not ($badgingQa -match "^package: name='com\.reylumi\.android\.qa' ")){
    throw 'This launcher installs only com.reylumi.android.qa. APK identity mismatch.'
}
$identityQa=Invoke-RestMethod 'http://localhost:3117/api/qa/environment' -TimeoutSec 15
if($identityQa.qa -ne $true -or $identityQa.simulation -ne $true -or $identityQa.project -ne 'reylumi-qa-20261111'){
    throw 'Expected the isolated local QA app on localhost:3117. Nothing was installed.'
}
$stateQa=& $adbQa -s $Serial get-state
if($LASTEXITCODE -ne 0 -or $stateQa.Trim() -ne 'device'){throw 'Requested device is not connected and authorized for ADB.'}
foreach($portQa in @(3117,55421)){
    & $adbQa -s $Serial reverse "tcp:$portQa" "tcp:$portQa"
    if($LASTEXITCODE -ne 0){throw "Could not forward QA port $portQa to the requested device."}
}
& $adbQa -s $Serial install -r -t $ApkPath
if($LASTEXITCODE -ne 0){throw 'QA APK install failed. The production app was not changed.'}
& $adbQa -s $Serial shell am start -n 'com.reylumi.android.qa/com.reylumi.android.MainActivity'
if($LASTEXITCODE -ne 0){throw 'QA APK was installed but could not be opened.'}
Write-Host 'Opened Reylumi QA (separate package). USB/ADB and the local QA server must remain connected.'
Write-Host 'Only synthetic data and local provider simulation are available. This does not test real Stripe payments.'
