param([string]$Serial='emulator-5580')
$ErrorActionPreference='Stop'
$adbQa='C:\Reylumi-worktrees\android-ipad-store-20261105\artifacts\toolchain\sdk\platform-tools\adb.exe'
if(-not (Test-Path $adbQa)){throw 'Set adbQa to the Android SDK platform-tools/adb.exe path'}
$identityQa=Invoke-RestMethod 'http://localhost:3117/api/qa/environment'
if($identityQa.project -ne 'reylumi-qa-20261111'){throw 'QA app identity mismatch'}
& $adbQa -s $Serial reverse tcp:3117 tcp:3117
& $adbQa -s $Serial reverse tcp:55421 tcp:55421
& $adbQa -s $Serial shell am start -a android.intent.action.VIEW -d 'http://localhost:3117/login' com.android.chrome
Write-Host 'Opened local QA in Android Chrome. This is not the production native app. Use Open-QA.ps1 on Windows for intercepted mock card checkout.'
