@echo off
setlocal
cd /d "%~dp0"

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

echo Using Python:
call %PYTHON_LAUNCHER% --version

powershell -NoProfile -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8689/health' -TimeoutSec 3; if ($health.status -eq 'ok' -and $health.model -eq 'PP-OCRv6-small') { exit 0 }; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
  echo OCR service is already running on http://127.0.0.1:8689.
  echo Reusing the existing service.
  goto :eof
)

if not exist ".venv\Scripts\python.exe" (
  call %PYTHON_LAUNCHER% -m venv .venv
  if errorlevel 1 goto :error
  call .venv\Scripts\python.exe -m pip install --upgrade pip
  if errorlevel 1 goto :error
  where nvidia-smi >nul 2>&1
  if errorlevel 1 (
    call .venv\Scripts\python.exe -m pip install -r requirements.txt
  ) else (
    echo NVIDIA GPU detected. Installing the CUDA 11.8 Paddle build...
    call .venv\Scripts\python.exe -m pip install -r requirements-gpu.txt
  )
  if errorlevel 1 goto :error
)

set FLAGS_use_mkldnn=0
set PADDLE_PDX_MODEL_SOURCE=BOS
call .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8689
goto :eof

:error
echo OCR service setup failed.
pause
exit /b 1
