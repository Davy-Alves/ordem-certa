$ErrorActionPreference='Stop'
foreach($name in @('DBSRV','TMSRV')) {
  Start-Process -FilePath (Join-Path $PSScriptRoot "$name.exe") -ArgumentList '--monitor' -WorkingDirectory $PSScriptRoot
}
