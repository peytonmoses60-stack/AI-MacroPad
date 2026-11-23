@echo off
cd /d "%~dp0"
title Agent Pad
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install the LTS version from nodejs.org, then run this again.
  pause
  exit /b 1
)
echo Starting Agent Pad. Keep this window open. Close it to stop the pad.
node src\server.js --open
pause
