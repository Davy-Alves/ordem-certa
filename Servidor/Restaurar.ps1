param([Parameter(Mandatory=$true)][string]$Backup)
$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'src\restore.mjs') $Backup
if($LASTEXITCODE) { throw 'A restauracao nao foi concluida.' }
