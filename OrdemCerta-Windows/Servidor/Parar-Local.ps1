$ErrorActionPreference='Stop'
$rootPath=[IO.Path]::GetFullPath($PSScriptRoot).TrimEnd('\')+'\'
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -in @('node.exe','DBSRV.exe','TMSRV.exe') -and $_.ExecutablePath -and $_.ExecutablePath.StartsWith($rootPath,[StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
