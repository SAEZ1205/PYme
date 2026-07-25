@echo off
setlocal
cd /d "%~dp0"
title MYPE Voz - Reparar espacio npm

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\REPARAR_ESPACIO_NPM.ps1"

endlocal
