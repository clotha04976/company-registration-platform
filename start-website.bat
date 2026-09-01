@echo off
setlocal

cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js was not found. Please install Node.js 22.17 or newer.
  pause
  exit /b 1
)

for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
if %NODE_MAJOR% LSS 22 (
  echo This project requires Node.js 22.17 or newer. Current version:
  node --version
  echo If you use nvm-windows, run: nvm use 22.17.0
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
echo The Node.js ERP API and identity OCR service start inside this window.

rem The virtual environments are built here because the Vite plugin only starts
rem services that already have one.
if not exist "ocr-service\.venv\Scripts\python.exe" (
  if "%VITE_IDENTITY_OCR_URL%"=="" call "%~dp0ocr-service\setup-venv.bat"
)

call npm run dev -- --open

if errorlevel 1 (
  echo The development server stopped with an error.
  pause
)

endlocal
