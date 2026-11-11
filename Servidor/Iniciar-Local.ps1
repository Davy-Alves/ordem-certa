$ErrorActionPreference='Stop'
foreach($name in @('DBSRV','TMSRV')) {
  Start-Process -FilePath (Join-Path $PSScriptRoot "$name.exe") -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
}
Write-Host 'Servidores iniciados em segundo plano. Consulte logs e abra Cliente\OrdemCerta.exe.'
Write-Host 'Para parar o teste local: execute Parar-Local.ps1.'
