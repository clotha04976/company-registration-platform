@echo off
setlocal

set "ROOT=%~dp0"
set "LABELME=%ROOT%.private\property-ocr\labelme-venv\Scripts\labelme.exe"
set "DATA=%ROOT%.private\property-ocr\labelme"

if not exist "%LABELME%" (
    echo LabelMe environment was not found.
    echo Install it with: py -3 -m venv "%ROOT%.private\property-ocr\labelme-venv"
    echo Then run: "%ROOT%.private\property-ocr\labelme-venv\Scripts\python.exe" -m pip install labelme
    pause
    exit /b 1
)

if not exist "%DATA%" (
    echo LabelMe dataset was not found: %DATA%
    pause
    exit /b 1
)

start "Property OCR LabelMe" "%LABELME%" "%DATA%" --labels "%DATA%\labels.txt" --output "%DATA%"
endlocal
