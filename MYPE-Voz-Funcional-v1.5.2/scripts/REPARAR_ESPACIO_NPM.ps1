$ErrorActionPreference = 'Continue'

$systemDrive = Get-PSDrive -Name $env:SystemDrive.TrimEnd(':')
$before = [int64]$systemDrive.Free

Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host '              LIMPIEZA SEGURA DE CACHE NPM' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host ('Espacio libre antes: {0:N2} GB' -f ($before / 1GB))
Write-Host ''

$paths = @(
  (Join-Path $env:LOCALAPPDATA 'npm-cache'),
  (Join-Path $env:APPDATA 'npm-cache')
)

foreach ($path in $paths) {
  if (Test-Path $path) {
    Write-Host "Eliminando cache npm: $path"
    Remove-Item -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue
  }
}

$tempCandidates = Get-ChildItem `
  -LiteralPath $env:TEMP `
  -Directory `
  -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -like 'npm-*' -or
    $_.Name -like '_cacache*'
  }

foreach ($directory in $tempCandidates) {
  Write-Host "Eliminando temporal npm: $($directory.FullName)"
  Remove-Item `
    -LiteralPath $directory.FullName `
    -Recurse `
    -Force `
    -ErrorAction SilentlyContinue
}

$systemDrive = Get-PSDrive -Name $env:SystemDrive.TrimEnd(':')
$after = [int64]$systemDrive.Free

Write-Host ''
Write-Host ('Espacio libre despues: {0:N2} GB' -f ($after / 1GB))
Write-Host ('Espacio recuperado: {0:N0} MB' -f (($after - $before) / 1MB))
Write-Host ''
Write-Host 'No se eliminaron documentos ni datos de MYPE Voz.'
Read-Host 'Presiona Enter para cerrar'
