@echo off
setlocal
cd /d "%~dp0"

if exist ".captcha-venv\Scripts\python.exe" goto :eof

set "CAPTCHA_PYTHON="
py -3.11 --version >nul 2>&1
if not errorlevel 1 set "CAPTCHA_PYTHON=py -3.11"

if not defined CAPTCHA_PYTHON (
  echo Python 3.11 was not found.
  goto :error
)

echo Creating the captcha OCR environment...
call %CAPTCHA_PYTHON% -m venv .captcha-venv
if errorlevel 1 goto :error
call .captcha-venv\Scripts\python.exe -m pip install --upgrade pip
if errorlevel 1 goto :error
call .captcha-venv\Scripts\python.exe -m pip install -r requirements-captcha.txt
if errorlevel 1 goto :error
goto :eof

:error
echo Captcha OCR setup failed. Manual captcha entry will remain available.
exit /b 1
