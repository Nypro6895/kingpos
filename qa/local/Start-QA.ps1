param([switch]$PrepareOnly)
$ErrorActionPreference='Stop'
$qaRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $qaRoot
try {
  node qa/local/prepare.mjs
  if ($LASTEXITCODE -ne 0) { throw 'QA preparation failed' }
  if (-not (docker network ls --filter name='^reylumi-qa-localhost-20261111$' -q)) { docker network create --driver bridge --opt com.docker.network.bridge.host_binding_ipv4=127.0.0.1 reylumi-qa-localhost-20261111 | Out-Null }
  supabase start --workdir qa/runtime --network-id reylumi-qa-localhost-20261111 -x logflare,vector,edge-runtime,supavisor *> qa/runtime/start.log
  if ($LASTEXITCODE -ne 0) { throw 'QA backend failed; see qa/runtime/start.log' }
  node qa/local/docker-loopback.mjs
  if ($LASTEXITCODE -ne 0) { throw 'QA loopback binding failed' }
  node qa/local/seed.mjs
  if ($LASTEXITCODE -ne 0) { throw 'QA synthetic data setup failed' }
  node qa/local/configure.mjs
  if ($LASTEXITCODE -ne 0) { throw 'QA booking configuration failed' }
  if ($PrepareOnly) { return }
  $providerReady=$false
  try { $providerReady=(Invoke-RestMethod 'http://127.0.0.1:3118/health').qa -eq $true } catch {}
  if (-not $providerReady) {
    Start-Process node -ArgumentList 'qa/local/providers.mjs' -WorkingDirectory $qaRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $qaRoot 'qa/runtime/providers.log') -RedirectStandardError (Join-Path $qaRoot 'qa/runtime/providers-error.log') | Out-Null
    Start-Sleep -Seconds 2
  }
  $identityQa=$null
  try {
    $identityQa=Invoke-RestMethod 'http://localhost:3117/api/qa/environment' -TimeoutSec 15
  } catch {}
  if ($identityQa.project -eq 'reylumi-qa-20261111' -and $identityQa.qa -eq $true) {
    Write-Host 'QA app already running at http://localhost:3117'
    return
  }
  if (Get-NetTCPConnection -LocalPort 3117 -State Listen -ErrorAction SilentlyContinue) { throw 'Port 3117 is occupied by an unverified server; leaving it untouched' }
  node qa/local/serve.mjs
} finally { Pop-Location }
