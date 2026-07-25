@echo off
setlocal
cd /d "%~dp0"
title MYPE Voz - Inicio

echo ==============================================================
echo                    INICIANDO MYPE VOZ
echo ==============================================================
echo.
echo Esta ventana permanecera abierta para mostrar cualquier error.
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\ABRIR_MYPE_VOZ.ps1"
set "RESULT=%ERRORLEVEL%"

echo.
if not "%RESULT%"=="0" (
  echo ==============================================================
  echo MYPE VOZ NO PUDO INICIAR
  echo ==============================================================
  echo.
  echo Codigo de salida: %RESULT%
  echo Revisa el mensaje anterior o:
  echo %~dp0inicio_mype_voz.log
  echo.
) else (
  echo MYPE Voz fue iniciado correctamente.
  echo Manten abierta la ventana "MYPE Voz - Servidores".
  echo.
)

pause
endlocal
