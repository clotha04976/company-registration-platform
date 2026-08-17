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
echo The case API and identity OCR service start inside this window.

rem The virtual environments are built here because the Vite plugin only starts
rem services that already have one.
if not exist "api-service\.venv\Scripts\python.exe" call "%~dp0api-service\setup-venv.bat"
if not exist "ocr-service\.venv\Scripts\python.exe" (
  if "%VITE_IDENTITY_OCR_URL%"=="" call "%~dp0ocr-service\setup-venv.bat"
)

call npm run dev -- --open

if errorlevel 1 (
  echo The development server stopped with an error.
  pause
)

endlocal
