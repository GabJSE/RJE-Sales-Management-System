@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0"
set "BACKEND_DIR=%PROJECT_ROOT%sales-system\backend"
set "FRONTEND_DIR=%PROJECT_ROOT%sales-system\frontend"

where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is required to start the RJE Sales Management System.
    echo Install Node.js from https://nodejs.org/ and try again.
    pause
    exit /b 1
)

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

if not exist "%BACKEND_DIR%\.env" (
    echo Backend configuration was not found.
    echo Create .env in "%BACKEND_DIR%" using .env.example as a guide.
    pause
    exit /b 1
)

if not exist "%BACKEND_DIR%\node_modules\.bin\nodemon.cmd" (
    echo Backend dependencies are missing. Run npm install in:
    echo "%BACKEND_DIR%"
    pause
    exit /b 1
)

if not exist "%FRONTEND_DIR%\node_modules\.bin\vite.cmd" (
    echo Frontend dependencies are missing. Run npm install in:
    echo "%FRONTEND_DIR%"
    pause
    exit /b 1
)

echo Starting the RJE Sales Management System...
echo The browser will open when the frontend is ready at http://localhost:5173.
echo Close both server windows to stop the system.
echo.

start "RJE Backend" /D "%BACKEND_DIR%" cmd /d /k "npm run dev"
start "RJE Frontend" /D "%FRONTEND_DIR%" cmd /d /k "npm run dev -- --port 5173 --strictPort --open"

exit /b 0
