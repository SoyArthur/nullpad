@echo off
title NULLPAD
color 0A
cd /d "%~dp0"

:: Quick pre-flight checks
if not exist ssl\cert.pem (
    echo  ERROR: SSL cert missing. Run install.bat first.
    pause & exit /b 1
)
if not exist node_modules (
    echo  ERROR: Dependencies missing. Run install.bat first.
    pause & exit /b 1
)
if not exist "node_modules\vigemclient\build\Release\vigemclient.node" (
    echo  ERROR: Native vigemclient module missing. Run install.bat first.
    pause & exit /b 1
)
sc query ViGEmBus >nul 2>&1
if errorlevel 1 (
    echo  ERROR: ViGEmBus driver is not installed or active. Run install.bat first.
    pause & exit /b 1
)

echo.
echo  [Network] Checking the current LAN certificate...
node scripts\ensure-cert.js
if errorlevel 1 (
    echo.
    echo  ERROR: Could not prepare the HTTPS certificate for the current LAN IP.
    pause
    exit /b 1
)

echo.
node server/index.js
pause
