@echo off
REM Graphwar Agents - doble clic y a jugar (no necesitas abrir terminal ni node a mano)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Falta Node.js (v18+). Descargalo de https://nodejs.org/ e intentalo de nuevo.
  pause
  exit /b 1
)
node tools\launch-selfplay.mjs
if errorlevel 1 pause
