$ErrorActionPreference = 'Continue'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$Host.UI.RawUI.WindowTitle = 'MYPE Voz - Servidores'

Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host '              SERVIDORES DE MYPE VOZ' -ForegroundColor Cyan
Write-Host '==============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Manten esta ventana abierta mientras uses la aplicacion.'
Write-Host ''
Write-Host 'Backend y frontend se inician por separado con Node.'
Write-Host ''

$node = Get-Command 'node.exe' -ErrorAction SilentlyContinue

if (-not $node) {
  Write-Host 'ERROR: Node.js no fue encontrado.' -ForegroundColor Red
  $result = 1
}
else {
  try {
    & $node.Source (Join-Path $ProjectRoot 'scripts\dev.mjs')
    $result = $LASTEXITCODE
  }
  catch {
    Write-Host ''
    Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
    $result = 1
  }
}

Write-Host ''
Write-Host '==============================================================' -ForegroundColor Yellow
Write-Host 'LOS SERVIDORES SE DETUVIERON' -ForegroundColor Yellow
Write-Host '==============================================================' -ForegroundColor Yellow
Write-Host ''
Write-Host "Codigo de salida: $result"
Write-Host 'Revisa las lineas anteriores para encontrar el error real.'
Write-Host ''
Read-Host 'Presiona Enter para cerrar esta ventana'
exit $result
