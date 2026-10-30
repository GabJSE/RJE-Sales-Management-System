@echo off
setlocal

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%sales-system\backend"
set "FRONTEND_DIR=%PROJECT_ROOT%sales-system\frontend"

where npm >nul 2>&1
if errorlevel 1 (
    echo Node.js and npm are required to start the RJE Sales Management System.
    echo Install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\package.json" (
    echo Backend project was not found:
    echo %BACKEND_DIR%
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\package.json" (
    echo Frontend project was not found:
    echo %FRONTEND_DIR%
    pause
    exit /b 1
)

start "RJE Backend" /D "%BACKEND_DIR%" cmd /k "npm run dev"
start "RJE Frontend" /D "%FRONTEND_DIR%" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul
start "" "http://localhost:5173"

exit /b 0
