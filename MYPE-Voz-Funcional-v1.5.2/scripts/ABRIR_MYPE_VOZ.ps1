$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogPath = Join-Path $ProjectRoot 'inicio_mype_voz.log'
$AppUrl = 'http://127.0.0.1:5173'
$AiHealthUrl = 'http://127.0.0.1:8787/api/health'
$OllamaUrl = 'http://127.0.0.1:11434/api/tags'
$RequiredModel = 'gemma3:4b'
$ExpectedAppVersion = '2.5.2'

$FrontendRoot = Join-Path $ProjectRoot 'frontend'
$BackendRoot = Join-Path $ProjectRoot 'backend'

$RuntimeRoot = Join-Path $ProjectRoot '.runtime'
$LocalNpmCache = Join-Path $RuntimeRoot 'npm-cache'
$LocalTemp = Join-Path $RuntimeRoot 'temp'

Set-Location $ProjectRoot

New-Item -ItemType Directory -Path $RuntimeRoot -Force | Out-Null
New-Item -ItemType Directory -Path $LocalNpmCache -Force | Out-Null
New-Item -ItemType Directory -Path $LocalTemp -Force | Out-Null

$env:TEMP = $LocalTemp
$env:TMP = $LocalTemp
$env:npm_config_cache = $LocalNpmCache
$env:npm_config_update_notifier = 'false'
$env:npm_config_audit = 'false'
$env:npm_config_fund = 'false'

Set-Content `
  -Path $LogPath `
  -Value "MYPE Voz v$ExpectedAppVersion - inicio $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" `
  -Encoding UTF8

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)

  $line = "[$(Get-Date -Format 'HH:mm:ss')] $Message"
  Write-Host $line
  Add-Content -Path $LogPath -Value $line -Encoding UTF8
}

function Test-Http {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$TimeoutSeconds = 3
  )

  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri $Url `
      -TimeoutSec $TimeoutSeconds

    return (
      $response.StatusCode -ge 200 -and
      $response.StatusCode -lt 500
    )
  }
  catch {
    return $false
  }
}

function Get-FreeSpaceBytes {
  param([Parameter(Mandatory = $true)][string]$Path)

  $item = Get-Item $Path
  $drive = Get-PSDrive -Name $item.PSDrive.Name
  return [int64]$drive.Free
}

function Format-Bytes {
  param([int64]$Bytes)

  if ($Bytes -ge 1GB) {
    return ('{0:N2} GB' -f ($Bytes / 1GB))
  }

  return ('{0:N0} MB' -f ($Bytes / 1MB))
}

function Test-Dependencies {
  $required = @(
    (Join-Path $FrontendRoot 'node_modules\vite\bin\vite.js'),
    (Join-Path $FrontendRoot 'node_modules\react\package.json'),
    (Join-Path $FrontendRoot 'node_modules\dexie\package.json'),
    (Join-Path $FrontendRoot 'node_modules\react-router-dom\package.json'),
    (Join-Path $FrontendRoot 'node_modules\lucide-react\package.json'),
    (Join-Path $FrontendRoot 'node_modules\tailwindcss\package.json'),
    (Join-Path $FrontendRoot 'node_modules\@tailwindcss\vite\package.json')
  )

  foreach ($file in $required) {
    if (-not (Test-Path $file)) {
      return $false
    }
  }

  return $true
}

function Find-Ollama {
  $command = Get-Command 'ollama.exe' -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'),
    (Join-Path $env:LOCALAPPDATA 'Ollama\ollama.exe'),
    (Join-Path $env:ProgramFiles 'Ollama\ollama.exe')
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Get-ProcessCommandLine {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  try {
    $process = Get-CimInstance `
      -ClassName Win32_Process `
      -Filter "ProcessId = $ProcessId" `
      -ErrorAction Stop

    return [string]$process.CommandLine
  }
  catch {
    return ''
  }
}

function Test-IsMypeVozProcess {
  param([Parameter(Mandatory = $true)][int]$ProcessId)

  $commandLine = Get-ProcessCommandLine -ProcessId $ProcessId
  if (-not $commandLine) {
    return $false
  }

  $isNode = $commandLine -match '(?i)\bnode(?:\.exe)?\b'
  $isMypeVoz =
    $commandLine -match '(?i)backend[\\/]+server[\\/]+index\.mjs' -or
    $commandLine -match '(?i)frontend[\\/]+node_modules[\\/]+vite[\\/]+bin[\\/]+vite\.js' -or
    $commandLine -match '(?i)scripts[\\/]+dev\.mjs'

  return $isNode -and $isMypeVoz
}

function Stop-OldMypeVozServers {
  Write-Step 'Buscando servidores anteriores de MYPE Voz...'

  $processIds = @()

  foreach ($port in @(5173, 8787)) {
    $connections = Get-NetTCPConnection `
      -State Listen `
      -LocalPort $port `
      -ErrorAction SilentlyContinue

    foreach ($connection in $connections) {
      if ($connection.OwningProcess) {
        $processIds += [int]$connection.OwningProcess
      }
    }
  }

  $processIds = $processIds | Sort-Object -Unique

  foreach ($processId in $processIds) {
    if (Test-IsMypeVozProcess -ProcessId $processId) {
      Write-Step "Cerrando servidor anterior PID $processId."
      Stop-Process `
        -Id $processId `
        -Force `
        -ErrorAction SilentlyContinue
    }
    else {
      throw "El puerto usado por MYPE Voz pertenece a otro programa (PID $processId)."
    }
  }

  Start-Sleep -Milliseconds 700
}

function Wait-ForUrl {
  param(
    [Parameter(Mandatory = $true)][string]$Url,
    [int]$MaximumSeconds = 120
  )

  for ($second = 1; $second -le $MaximumSeconds; $second += 1) {
    if (Test-Http -Url $Url -TimeoutSeconds 2) {
      return $true
    }

    if ($second % 10 -eq 0) {
      Write-Step "Aun esperando al servidor... $second segundos."
    }

    Start-Sleep -Seconds 1
  }

  return $false
}

function Test-CompatibleAiServer {
  try {
    $status = Invoke-RestMethod `
      -Uri $AiHealthUrl `
      -TimeoutSec 3

    return (
      $status.ok -eq $true -and
      $status.appVersion -eq $ExpectedAppVersion
    )
  }
  catch {
    return $false
  }
}

function Wait-ForCompatibleAiServer {
  param([int]$MaximumSeconds = 120)

  for ($second = 1; $second -le $MaximumSeconds; $second += 1) {
    if (Test-CompatibleAiServer) {
      return $true
    }

    Start-Sleep -Seconds 1
  }

  return $false
}

try {
  Write-Step "Iniciando MYPE Voz v$ExpectedAppVersion..."
  Write-Step "Temporales locales: $RuntimeRoot"

  Stop-OldMypeVozServers

  $frontendPackageJson = Join-Path $FrontendRoot 'package.json'
  $backendPackageJson = Join-Path $BackendRoot 'package.json'

  if (-not (Test-Path $frontendPackageJson)) {
    throw 'No se encontro frontend\package.json. Descomprime el ZIP completo.'
  }

  if (-not (Test-Path $backendPackageJson)) {
    throw 'No se encontro backend\package.json. Descomprime el ZIP completo.'
  }

  $nodeCommand = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if (-not $nodeCommand) {
    throw 'Node.js no esta instalado o no aparece en PATH.'
  }

  $npmCommand = Get-Command 'npm.cmd' -ErrorAction SilentlyContinue
  if (-not $npmCommand) {
    throw 'npm no fue encontrado. Reinstala Node.js incluyendo npm.'
  }

  $nodeVersionText = (& $nodeCommand.Source --version).Trim().TrimStart('v')
  $nodeVersion = [version]$nodeVersionText
  Write-Step "Node.js detectado: $nodeVersionText"

  $minimumNode20 = [version]'20.19.0'
  $minimumNode22 = [version]'22.12.0'
  $nodeSupported =
    (($nodeVersion.Major -eq 20) -and ($nodeVersion -ge $minimumNode20)) -or
    (($nodeVersion.Major -eq 22) -and ($nodeVersion -ge $minimumNode22)) -or
    ($nodeVersion.Major -gt 22)

  if (-not $nodeSupported) {
    throw "Node.js $nodeVersionText no es compatible."
  }

  $projectFree = Get-FreeSpaceBytes -Path $ProjectRoot
  Write-Step "Espacio libre en la unidad del proyecto: $(Format-Bytes $projectFree)"

  if ($projectFree -lt 300MB) {
    throw 'La unidad del proyecto tiene menos de 300 MB libres.'
  }

  $systemFree = Get-FreeSpaceBytes -Path $env:LOCALAPPDATA
  Write-Step "Espacio libre en la unidad del sistema: $(Format-Bytes $systemFree)"

  if ($systemFree -lt 80MB) {
    throw 'Windows tiene menos de 80 MB libres. Ejecuta REPARAR_ESPACIO_NPM.bat y libera espacio en C:.'
  }

  $ollamaPath = Find-Ollama

  if ($ollamaPath) {
    Write-Step "Ollama encontrado: $ollamaPath"

    if (-not (Test-Http -Url $OllamaUrl -TimeoutSeconds 3)) {
      Write-Step 'Iniciando Ollama...'
      Start-Process `
        -FilePath $ollamaPath `
        -ArgumentList 'serve' `
        -WindowStyle Minimized

      Start-Sleep -Seconds 5
    }

    if (Test-Http -Url $OllamaUrl -TimeoutSeconds 5) {
      Write-Step 'Ollama esta activo.'

      $modelList = (& $ollamaPath list 2>&1 | Out-String)

      if ($modelList -match [regex]::Escape($RequiredModel)) {
        Write-Step "$RequiredModel esta instalado."
      }
      else {
        Write-Step "ADVERTENCIA: falta $RequiredModel."
      }
    }
    else {
      Write-Step 'ADVERTENCIA: Ollama no respondio.'
    }
  }
  else {
    Write-Step 'ADVERTENCIA: Ollama no fue encontrado.'
  }

  if (-not (Test-Dependencies)) {
    if ($projectFree -lt 1500MB) {
      throw 'Faltan dependencias y la unidad del proyecto tiene menos de 1.5 GB libres.'
    }

    Write-Step 'Instalando o reparando dependencias del frontend...'
    Write-Step "Cache npm local: $LocalNpmCache"

    Push-Location $FrontendRoot

    try {
      & $npmCommand.Source `
        install `
        --no-audit `
        --no-fund `
        --prefer-offline `
        2>&1 |
        Tee-Object -FilePath $LogPath -Append |
        Write-Host
    }
    finally {
      Pop-Location
    }

    if ($LASTEXITCODE -ne 0) {
      throw "npm install termino con el codigo $LASTEXITCODE."
    }

    if (-not (Test-Dependencies)) {
      throw 'npm termino, pero las dependencias siguen incompletas.'
    }

    Write-Step 'Dependencias instaladas correctamente.'
  }
  else {
    Write-Step 'Dependencias completas. npm no se ejecutara al iniciar.'
  }

  $serverScript = Join-Path $PSScriptRoot 'INICIAR_SERVIDORES.ps1'
  if (-not (Test-Path $serverScript)) {
    throw 'No se encontro scripts\INICIAR_SERVIDORES.ps1.'
  }

  Write-Step 'Abriendo la ventana de servidores...'

  $serverArguments = @(
    '-NoLogo',
    '-NoProfile',
    '-NoExit',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    "`"$serverScript`""
  )

  Start-Process `
    -FilePath 'powershell.exe' `
    -ArgumentList $serverArguments `
    -WorkingDirectory $ProjectRoot

  Write-Step 'Esperando a que localhost:5173 responda...'

  if (-not (Wait-ForUrl -Url $AppUrl -MaximumSeconds 120)) {
    throw 'El servidor web no respondio en 120 segundos.'
  }

  Write-Step "Esperando al servidor IA v$ExpectedAppVersion..."

  if (-not (Wait-ForCompatibleAiServer -MaximumSeconds 120)) {
    throw "El servidor IA no inicio con la version $ExpectedAppVersion."
  }

  Write-Step "Servidor IA v$ExpectedAppVersion verificado."
  Start-Process $AppUrl
  Write-Step 'Navegador abierto.'
  exit 0
}
catch {
  $message = $_.Exception.Message
  Write-Host ''
  Write-Host "ERROR: $message" -ForegroundColor Red
  Add-Content -Path $LogPath -Value "ERROR: $message" -Encoding UTF8
  exit 1
}
