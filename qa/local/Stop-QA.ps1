$ErrorActionPreference='Stop'
$qaRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runtimeQa=Join-Path $qaRoot 'qa/runtime'
foreach($entryQa in @(@('app-process.json','serve.mjs'),@('provider-process.json','providers.mjs'))) {
  $statePathQa=Join-Path $runtimeQa $entryQa[0]
  if(-not (Test-Path $statePathQa)){continue}
  $stateQa=Get-Content -LiteralPath $statePathQa -Raw | ConvertFrom-Json
  if($stateQa.root -notin @($qaRoot,$runtimeQa)){throw 'Unexpected QA process root'}
  $processQa=Get-CimInstance Win32_Process -Filter "ProcessId=$($stateQa.pid)"
  if(-not $processQa){continue}
  if($processQa.Name -ne 'node.exe' -or $processQa.CommandLine -notlike ('*qa/local/'+$entryQa[1]+'*')){throw 'QA PID has a different owner; leaving it untouched'}
  if([math]::Abs(($processQa.CreationDate.ToUniversalTime()-([datetime]$stateQa.startedAt).ToUniversalTime()).TotalSeconds) -gt 60){throw 'QA PID was reused; leaving it untouched'}
  $inventoryQa=Get-CimInstance Win32_Process
  $pendingQa=@([int]$processQa.ProcessId);$ownedQa=@()
  while($pendingQa.Count){$currentQa=$pendingQa[0];$pendingQa=@($pendingQa | Select-Object -Skip 1);$ownedQa+=$currentQa;$pendingQa+=@($inventoryQa | Where-Object {$_.ParentProcessId -eq $currentQa} | ForEach-Object {[int]$_.ProcessId})}
  Stop-Process -Id $ownedQa -ErrorAction SilentlyContinue
}
Push-Location $qaRoot
try {supabase stop --workdir qa/runtime *> qa/runtime/stop.log;if($LASTEXITCODE -ne 0){throw 'QA backend stop failed; see qa/runtime/stop.log'}} finally {Pop-Location}
Write-Host 'Stopped only this QA environment. Its database volumes and fixture files were preserved.'
