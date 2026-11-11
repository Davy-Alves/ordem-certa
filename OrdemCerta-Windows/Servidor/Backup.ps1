$ErrorActionPreference='Stop'
& (Join-Path $PSScriptRoot 'runtime\node.exe') (Join-Path $PSScriptRoot 'src\backup.mjs')
if($LASTEXITCODE) { throw 'Falha no backup. Consulte a mensagem acima.' }
