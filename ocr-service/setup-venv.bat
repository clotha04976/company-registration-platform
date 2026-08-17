@echo off
rem Builds the virtual environment only. The service itself is started by the
rem Vite dev server (see build\python-services-plugin.ts).
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto :eof

set "PYTHON_LAUNCHER="
py -3.11 --version >nul 2>&1
if not errorlevel 1 set "PYTHON_LAUNCHER=py -3.11"

if not defined PYTHON_LAUNCHER (
  py -3.10 --version >nul 2>&1
  if not errorlevel 1 set "PYTHON_LAUNCHER=py -3.10"
)

if not defined PYTHON_LAUNCHER (
  echo Python 3.10 or 3.11 was not found.
  echo Please install Python 3.10 or 3.11 and try again.
  goto :error
)

echo Creating the identity OCR virtual environment...
call %PYTHON_LAUNCHER% -m venv .venv
if errorlevel 1 goto :error
call .venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto :error
rem CPU is the default: it installs anywhere and needs no CUDA-matched wheels.
rem Set OCR_GPU=1 before running this script to install the CUDA 11.8 build.
if "%OCR_GPU%"=="1" (
  echo Installing the CUDA 11.8 Paddle build...
  call .venv\Scripts\python.exe -m pip install -r requirements-gpu.txt
) else (
  call .venv\Scripts\python.exe -m pip install -r requirements.txt
)
if errorlevel 1 goto :error
goto :eof

:error
echo OCR service setup failed.
pause
exit /b 1
