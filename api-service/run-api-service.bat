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

powershell -NoProfile -Command "try { $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8690/health' -TimeoutSec 3; if ($health.status -eq 'ok') { exit 0 }; exit 1 } catch { exit 1 }"
if not errorlevel 1 (
  echo Case API is already running on http://127.0.0.1:8690.
  echo Reusing the existing service.
  goto :eof
)

call "%~dp0setup-venv.bat"
if errorlevel 1 goto :error

call .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8690
goto :eof

:error
echo Case API setup failed.
pause
exit /b 1
