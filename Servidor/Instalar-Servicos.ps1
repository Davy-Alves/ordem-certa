# Execute como administrador, depois de configurar servidor.json.
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]$identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Execute este script como administrador.' }
foreach ($name in @('DBSRV','TMSRV')) {
  $service = "OrdemCerta$name"
  if (Get-Service -Name $service -ErrorAction SilentlyContinue) { throw "O servico $service ja existe. Nao foi substituido." }
}
foreach ($name in @('DBSRV','TMSRV')) {
  $bin = '"' + (Join-Path $PSScriptRoot "$name.exe") + '" --service'
  $account = "NT SERVICE\OrdemCerta$name"
  & sc.exe create "OrdemCerta$name" binPath= $bin start= auto obj= $account DisplayName= "Ordem Certa $name"
  if ($LASTEXITCODE) { throw "Falha ao instalar $name." }
  & icacls.exe $PSScriptRoot /grant "${account}:(OI)(CI)RX" /T /Q | Out-Null
  if ($LASTEXITCODE) { throw "Falha ao conceder leitura para $name." }
  $logs = Join-Path $PSScriptRoot 'logs'
  New-Item -ItemType Directory -Force $logs | Out-Null
  & icacls.exe $logs /grant "${account}:(OI)(CI)M" /T /Q | Out-Null
  if ($LASTEXITCODE) { throw "Falha ao conceder gravacao de logs para $name." }
  if ($name -eq 'DBSRV') {
    $cfg = Get-Content (Join-Path $PSScriptRoot 'servidor.json') -Raw | ConvertFrom-Json
    $data = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $cfg.dataDir))
    New-Item -ItemType Directory -Force $data | Out-Null
    & icacls.exe $data /grant "${account}:(OI)(CI)M" /T /Q | Out-Null
    if ($LASTEXITCODE) { throw 'Falha ao conceder acesso ao banco.' }
  }
  & sc.exe failure "OrdemCerta$name" reset= 86400 actions= restart/10000/restart/30000/restart/60000
}
& sc.exe config OrdemCertaTMSRV depend= OrdemCertaDBSRV
Start-Service OrdemCertaDBSRV
Start-Service OrdemCertaTMSRV
Write-Host 'Servicos instalados. Configure HTTPS e firewall conforme o guia antes de acesso externo.'
