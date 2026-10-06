# ORIVEXY NIGHTS — instalador para Windows sin la ventana de SmartScreen.
#
#   irm https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/install.ps1 | iex
#
# Descarga el instalador oficial de la última versión desde GitHub Releases,
# lo instala en silencio (Windows pide confirmar permisos de administrador
# una vez, como cualquier programa en "Archivos de programa") y abre la app.
# APP_INSTALLER=<ruta a un .exe> usa un instalador local (pruebas).

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue' # la barra de progreso hace lentísima la descarga en PowerShell 5
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$url = 'https://github.com/Orivexy/ORIVEXY-Nights/releases/latest/download/ORIVEXY-NIGHTS-Windows.exe'
$setup = Join-Path $env:TEMP 'ORIVEXY-NIGHTS-Setup.exe'

Write-Host ''
Write-Host '  ORIVEXY NIGHTS' -ForegroundColor Magenta
if ($env:APP_INSTALLER) {
  Copy-Item -LiteralPath $env:APP_INSTALLER -Destination $setup -Force
} else {
  Write-Host '  Descargando la ultima version...'
  Invoke-WebRequest -Uri $url -OutFile $setup -UseBasicParsing
}
# Es nuestro propio instalador: se quita la marca de "descargado de Internet".
Unblock-File -LiteralPath $setup

Write-Host '  Instalando (acepta el permiso de administrador si Windows lo pide)...'
$p = Start-Process -FilePath $setup -ArgumentList '/S' -Verb RunAs -Wait -PassThru
Remove-Item -LiteralPath $setup -Force -ErrorAction SilentlyContinue
if ($p.ExitCode -ne 0) { throw "La instalacion no se completo (codigo $($p.ExitCode))." }

# Dónde quedó instalada (instalaciones nuevas o actualizaciones de NIVEX).
$candidates = @(
  (Join-Path $env:ProgramFiles 'ORIVEXY NIGHTS\ORIVEXY NIGHTS.exe'),
  (Join-Path $env:ProgramFiles 'Nombre en proceso\ORIVEXY NIGHTS.exe'),
  (Join-Path $env:ProgramFiles 'Nombre en proceso\Nombre en proceso.exe'),
  (Join-Path $env:ProgramFiles 'NIVEX\ORIVEXY NIGHTS.exe')
)
$key = Get-ChildItem 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall' -ErrorAction SilentlyContinue |
  Get-ItemProperty -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'ORIVEXY NIGHTS*' -or $_.DisplayName -like 'Nombre en proceso*' } | Select-Object -First 1
if ($key -and $key.InstallLocation) { $candidates = @((Join-Path $key.InstallLocation 'ORIVEXY NIGHTS.exe'), (Join-Path $key.InstallLocation 'Nombre en proceso.exe')) + $candidates }
$exe = $candidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $exe) { throw 'No se encontro ORIVEXY NIGHTS despues de instalar.' }

Write-Host '  Listo. Abriendo ORIVEXY NIGHTS...' -ForegroundColor Green
if (-not $env:APP_NO_LAUNCH) { Start-Process -FilePath $exe }
