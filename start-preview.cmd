@echo off
rem NEURON local preview for Windows: installs dependencies once, then runs http://localhost:3000
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 20+ is required: https://nodejs.org & pause & exit /b 1)
if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm install --no-audit --no-fund || (pause & exit /b 1)
)
start "" http://localhost:3000
call npm run preview
pause
