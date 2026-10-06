@echo off
rem Double-click to open the Skyworth 3GPP Decoder locally.
rem The site must be served over http (opening out\index.html directly cannot work).
cd /d "%~dp0"
if not exist "out\index.html" (
  echo Building the site first, this takes about a minute...
  call npm run build || (echo Build failed. & pause & exit /b 1)
)
node scripts\preview.mjs
pause
