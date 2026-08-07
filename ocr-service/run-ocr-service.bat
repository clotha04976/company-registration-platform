@echo off
setlocal
cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv
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
