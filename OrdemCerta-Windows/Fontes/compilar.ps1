$ErrorActionPreference = 'Stop'
$package = Split-Path $PSScriptRoot -Parent
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
Push-Location $PSScriptRoot
try {
  & $compiler /nologo /target:winexe /platform:x64 /out:..\Cliente\OrdemCerta.exe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:..\Cliente\Microsoft.Web.WebView2.Core.dll /reference:..\Cliente\Microsoft.Web.WebView2.WinForms.dll Cliente.cs
  if ($LASTEXITCODE) { throw 'Falha ao compilar cliente' }
  & $compiler /nologo /target:exe /platform:x64 /out:..\Servidor\DBSRV.exe /reference:System.ServiceProcess.dll Servidor.cs
  if ($LASTEXITCODE) { throw 'Falha ao compilar DBSRV' }
  & $compiler /nologo /target:exe /platform:x64 /out:..\Servidor\TMSRV.exe /reference:System.ServiceProcess.dll Servidor.cs
  if ($LASTEXITCODE) { throw 'Falha ao compilar TMSRV' }
  Compress-Archive -Path ..\Cliente\* -DestinationPath cliente.zip -Force
  & $compiler /nologo /target:winexe /platform:x64 /out:..\InstalarCliente.exe /reference:System.Windows.Forms.dll /reference:System.IO.Compression.dll /reference:System.IO.Compression.FileSystem.dll /reference:Microsoft.CSharp.dll /resource:cliente.zip,cliente.zip InstalarCliente.cs
  if ($LASTEXITCODE) { throw 'Falha ao compilar instalador' }
} finally { Pop-Location }
