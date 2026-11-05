$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$exampleRoot=Join-Path $projectRoot 'examples/qr-menu'
$zipPath=Join-Path $projectRoot 'public/developer/qr-menu-example.zip'
$names=@('server.mjs','local.mjs','serverless.mjs','postgres-store.mjs','refresh-attempt.mjs','hosted-auth.mjs','hosted-config.mjs','hosted-mfa.mjs','api/index.mjs','manifest.json','package.json','package-lock.json','qa-targets.json','vercel.json','storage.sql','mfa-storage-upgrade.sql','README.md','STORAGE.md','HOSTED.md','MFA.md')
$entries=[ordered]@{}
foreach($name in ($names | Sort-Object)) {
  $file=Join-Path $exampleRoot $name
  if(-not (Test-Path -LiteralPath $file -PathType Leaf)){throw "Missing example source: $name"}
  $bytes=[IO.File]::ReadAllBytes($file)
  if($name -eq 'README.md'){$bytes=[Text.Encoding]::UTF8.GetBytes(([Text.Encoding]::UTF8.GetString($bytes)).Replace('../../docs/market-published-data-contract.md','CONTRACT.md'))}
  $entries[$name]=$bytes
}
$entries['CONTRACT.md']=[IO.File]::ReadAllBytes((Join-Path $projectRoot 'docs/market-published-data-contract.md'))
$manifest=@($entries.Keys | ForEach-Object {[ordered]@{path=$_;sha256=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($entries[$_])).ToLowerInvariant();bytes=$entries[$_].Length}})
$entries['PACKAGE-MANIFEST.json']=[Text.Encoding]::UTF8.GetBytes(([ordered]@{purpose='Review-only source example; no credentials or deployment';files=$manifest}|ConvertTo-Json -Depth 6))
Add-Type -AssemblyName System.IO.Compression
$stream=[IO.File]::Open($zipPath,[IO.FileMode]::Create,[IO.FileAccess]::Write)
$archive=[IO.Compression.ZipArchive]::new($stream,[IO.Compression.ZipArchiveMode]::Create,$false)
try {
  foreach($name in $entries.Keys){$entry=$archive.CreateEntry($name,[IO.Compression.CompressionLevel]::Optimal);$entry.LastWriteTime=[DateTimeOffset]::new(1980,1,1,0,0,0,[TimeSpan]::Zero);$target=$entry.Open();try{$target.Write($entries[$name],0,$entries[$name].Length)}finally{$target.Dispose()}}
}finally{$archive.Dispose();$stream.Dispose()}
$read=[IO.Compression.ZipFile]::OpenRead($zipPath)
try {if($read.Entries.Count -ne $entries.Count){throw 'Archive entry mismatch'};foreach($entry in $read.Entries){$inputStream=$entry.Open();$copy=[IO.MemoryStream]::new();try{$inputStream.CopyTo($copy);$actual=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($copy.ToArray()));$expected=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($entries[$entry.FullName]));if($actual -ne $expected){throw "Archive hash mismatch: $($entry.FullName)"}}finally{$inputStream.Dispose();$copy.Dispose()}}}finally{$read.Dispose()}
Write-Output "QR source archive verified: $($entries.Count) entries; no dependencies, env files or credentials packaged."
