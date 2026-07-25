@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title MYPE Voz - Instalar Gemma

set "MODEL=gemma3:4b"
set "OLLAMA_EXE="

:INICIO
cls
echo ==============================================================
echo              MYPE VOZ - INSTALAR GEMMA
echo ==============================================================
echo.
echo Este proceso comprobara Ollama y descargara %MODEL%.
echo La descarga del modelo ocupa varios GB.
echo No cierres esta ventana mientras Ollama este descargando.
echo.
pause

:BUSCAR_OLLAMA
call :ENCONTRAR_OLLAMA

if defined OLLAMA_EXE goto INICIAR_OLLAMA

cls
echo ==============================================================
echo OLLAMA NO ESTA INSTALADO
echo ==============================================================
echo.
echo 1. Presiona A para abrir la pagina oficial de Ollama.
echo 2. Descarga e instala la version para Windows.
echo 3. Regresa a esta ventana.
echo 4. Presiona C para comprobar nuevamente.
echo.
choice /C ACS /N /M "A = abrir descarga, C = comprobar, S = salir: "
if errorlevel 3 goto FIN
if errorlevel 2 goto BUSCAR_OLLAMA
start "" "https://ollama.com/download/windows"
echo.
echo La pagina oficial fue abierta.
echo Termina la instalacion de Ollama y vuelve a esta ventana.
echo.
pause
goto BUSCAR_OLLAMA

:INICIAR_OLLAMA
cls
echo ==============================================================
echo OLLAMA ENCONTRADO
echo ==============================================================
echo.
echo Ruta:
echo %OLLAMA_EXE%
echo.

powershell -NoLogo -NoProfile -Command ^
  "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo Iniciando el servidor local de Ollama...
  start "Ollama" /min "%OLLAMA_EXE%" serve
  timeout /t 5 /nobreak >nul
) else (
  echo El servidor local de Ollama ya esta activo.
)

powershell -NoLogo -NoProfile -Command ^
  "try { Invoke-RestMethod -Uri 'http://127.0.0.1:11434/api/tags' -TimeoutSec 5 | Out-Null; exit 0 } catch { exit 1 }"

if errorlevel 1 (
  echo.
  echo ERROR: Ollama esta instalado, pero su servidor no responde.
  echo Abre la aplicacion Ollama y vuelve a ejecutar este archivo.
  echo.
  pause
  goto FIN
)

"%OLLAMA_EXE%" list | findstr /I /C:"%MODEL%" >nul
if not errorlevel 1 goto MODELO_LISTO

cls
echo ==============================================================
echo DESCARGANDO %MODEL%
echo ==============================================================
echo.
echo No cierres esta ventana.
echo Espera hasta que Ollama muestre: success
echo.

"%OLLAMA_EXE%" pull %MODEL%
set "PULL_RESULT=%ERRORLEVEL%"

if not "%PULL_RESULT%"=="0" (
  echo.
  echo ==============================================================
  echo LA DESCARGA NO TERMINO CORRECTAMENTE
  echo ==============================================================
  echo.
  echo Codigo de salida: %PULL_RESULT%
  echo Revisa la linea que comienza con Error.
  echo.
  choice /C RS /N /M "R = reintentar, S = salir: "
  if errorlevel 2 goto FIN
  goto INICIAR_OLLAMA
)

"%OLLAMA_EXE%" list | findstr /I /C:"%MODEL%" >nul
if errorlevel 1 (
  echo.
  echo ERROR: La descarga termino, pero %MODEL% no aparece instalado.
  echo.
  pause
  goto FIN
)

:MODELO_LISTO
cls
echo ==============================================================
echo GEMMA ESTA INSTALADO Y LISTO
echo ==============================================================
echo.
echo Modelo encontrado: %MODEL%
echo.
"%OLLAMA_EXE%" list
echo.
choice /C AC /N /M "A = abrir MYPE Voz, C = cerrar: "
if errorlevel 2 goto FIN
call "%~dp0ABRIR_MYPE_VOZ.bat"
goto FIN

:ENCONTRAR_OLLAMA
set "OLLAMA_EXE="
for /f "delims=" %%I in ('where ollama.exe 2^>nul') do (
  if not defined OLLAMA_EXE set "OLLAMA_EXE=%%I"
)
if exist "%LOCALAPPDATA%\Programs\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Programs\Ollama\ollama.exe"
if exist "%LOCALAPPDATA%\Ollama\ollama.exe" set "OLLAMA_EXE=%LOCALAPPDATA%\Ollama\ollama.exe"
if exist "%ProgramFiles%\Ollama\ollama.exe" set "OLLAMA_EXE=%ProgramFiles%\Ollama\ollama.exe"
exit /b 0

:FIN
echo.
echo Puedes ejecutar este archivo nuevamente cuando lo necesites.
echo.
pause
endlocal
