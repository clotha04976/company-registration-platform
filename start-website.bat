@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22.13 or newer.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting the website...
echo Keep this window open while using the website.
start "Identity OCR Service" cmd /k call "%~dp0ocr-service\run-ocr-service.bat"
call npm run dev -- --open

if errorlevel 1 (
  echo The development server stopped with an error.
  pause
)

endlocal
