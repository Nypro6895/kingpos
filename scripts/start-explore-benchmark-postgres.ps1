param(
  [string]$RuntimePath = 'work/explore-load-runtime',
  [int]$Port = 55439
)
$ErrorActionPreference = 'Stop'
$workspaceFull = [IO.Path]::GetFullPath((Get-Location).Path)
$runtimeFull = [IO.Path]::GetFullPath((Join-Path $workspaceFull $RuntimePath))
if (-not $runtimeFull.StartsWith($workspaceFull + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
  throw 'The runtime must be inside the current workspace.'
}
if ($Port -lt 1024 -or $Port -gt 65535) { throw 'Invalid local port.' }
$archivePath = Join-Path $runtimeFull 'postgresql-17-binaries.zip'
$postgresRoot = Join-Path $runtimeFull 'pgsql'
$dataPath = Join-Path $runtimeFull 'data'
$binPath = Join-Path $postgresRoot 'bin'
if (-not (Test-Path (Join-Path $binPath 'postgres.exe'))) {
  if (-not (Test-Path $archivePath)) {
    throw 'Download the official PostgreSQL binary ZIP into the runtime first. See docs/explore-load-testing.md.'
  }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
  try {
    foreach ($entry in $archive.Entries) {
      if ($entry.FullName -notmatch '^pgsql/(bin|lib|share)/' -or $entry.FullName.EndsWith('/')) { continue }
      $targetPath = [IO.Path]::GetFullPath((Join-Path $runtimeFull $entry.FullName))
      if (-not $targetPath.StartsWith($runtimeFull + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Archive target escaped the runtime directory.'
      }
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($targetPath)) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$targetPath,$true)
    }
  } finally { $archive.Dispose() }
}
if (-not (Test-Path (Join-Path $dataPath 'PG_VERSION'))) {
  & (Join-Path $binPath 'initdb.exe') -D $dataPath -U explore_bench -A trust -E UTF8 --locale=C
  if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL initialization failed.' }
}
$existingProcess = Join-Path $dataPath 'postmaster.pid'
if (-not (Test-Path $existingProcess)) {
  $postgresArguments = @('-D',"`"$dataPath`"",'-p',"$Port",'-h','127.0.0.1',
    '-c','shared_preload_libraries=pg_stat_statements','-c','pg_stat_statements.track=all',
    '-c','max_connections=40','-c','shared_buffers=256MB','-c','work_mem=8MB','-c','jit=off')
  $process = Start-Process -FilePath (Join-Path $binPath 'postgres.exe') -ArgumentList $postgresArguments `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runtimeFull 'server-output.log') `
    -RedirectStandardError (Join-Path $runtimeFull 'server-error.log')
  $process.Id | Set-Content (Join-Path $runtimeFull 'benchmark-postgres.pid')
}
$ready = $false
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  & (Join-Path $binPath 'pg_isready.exe') -h 127.0.0.1 -p $Port -U explore_bench -t 1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Milliseconds 500
}
if (-not $ready) { throw 'Local PostgreSQL did not become ready. Inspect runtime/server-error.log.' }
$databaseExists = [string](& (Join-Path $binPath 'psql.exe') -h 127.0.0.1 -p $Port -U explore_bench -d postgres -t -A `
  -c "SELECT 1 FROM pg_database WHERE datname='explore_load'")
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the dedicated database.' }
if ([string]::IsNullOrWhiteSpace($databaseExists) -or $databaseExists.Trim() -ne '1') {
  & (Join-Path $binPath 'createdb.exe') -h 127.0.0.1 -p $Port -U explore_bench explore_load
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the dedicated benchmark database.' }
}
$connection = "postgresql://explore_bench@127.0.0.1:$Port/explore_load"
@{databaseUrl=$connection;runtime=$runtimeFull;port=$Port} | ConvertTo-Json | Set-Content (Join-Path $runtimeFull 'connection.json')
Write-Output "Isolated benchmark database ready at 127.0.0.1:$Port (explore_load)."
Write-Output 'Stop when finished with: pgsql/bin/pg_ctl.exe -D <runtime>/data -m fast stop'
