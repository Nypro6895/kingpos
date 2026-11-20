param([ValidateSet('owner','staff','customer','outsider','reviewer')][string]$Role='owner')
$qaRoot=Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Push-Location $qaRoot
try { node qa/local/browser.mjs "--role=$Role" } finally { Pop-Location }
