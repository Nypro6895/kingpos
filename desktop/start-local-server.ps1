$ErrorActionPreference = 'Stop'
# Local test channel only. Never replaces a listener or touches POS data.
$repo = Split-Path -Parent $PSScriptRoot
try {
  $health = Invoke-RestMethod -Uri 'http://localhost:3107/api/pos/connection' -TimeoutSec 3
  if ($health.available -eq $true) { exit 0 }
} catch { }
if (Get-NetTCPConnection -LocalPort 3107 -State Listen -ErrorAction SilentlyContinue) { exit 0 }
if (-not (Test-Path -LiteralPath (Join-Path $repo '.next/BUILD_ID'))) { exit 1 }
$node = (Get-Command node.exe -ErrorAction Stop).Source
Start-Process -FilePath $node -ArgumentList @('node_modules/next/dist/bin/next', 'start', '--port', '3107') -WorkingDirectory $repo -WindowStyle Hidden -RedirectStandardOutput (Join-Path $repo 'work/pos-preview.stdout.log') -RedirectStandardError (Join-Path $repo 'work/pos-preview.stderr.log')
