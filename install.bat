@echo off
setlocal EnableExtensions DisableDelayedExpansion
title NULLPAD Installer
color 0A
cd /d "%~dp0"
set "ROOT=%~dp0"
set "VS_BOOTSTRAP=%TEMP%\NULLPAD_vs_buildtools.exe"

:: ── Administrator elevation ─────────────────────────────────────────────────────
net session >nul 2>&1
if errorlevel 1 (
    echo.
    echo  NULLPAD needs Administrator permissions to install system drivers,
    echo  Visual Studio C++ Build Tools, and configure the firewall.
    echo.
    echo  Requesting Administrator permission...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    if errorlevel 1 (
        echo.
        echo  ERROR: Administrator elevation was cancelled or failed.
        pause
        exit /b 1
    )
    exit /b 0
)

echo.
echo  ╔══════════════════════════════════════╗
echo  ║       NULLPAD  Installer  v1.1       ║
echo  ╚══════════════════════════════════════╝
echo.
echo  Running as Administrator.
echo.

:: ── 1. Check Node.js ────────────────────────────────────────────────────────────
echo [1/6] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 call :init_fnm
where node >nul 2>&1
if errorlevel 1 goto :node_missing

set "NODE_VER="
for /f "delims=" %%v in ('node -v') do set "NODE_VER=%%v"
if not defined NODE_VER goto :node_missing
echo  OK: %NODE_VER%

:: ── 2. Check ViGEmBus driver ────────────────────────────────────────────────────
echo.
echo [2/6] Checking ViGEmBus driver...
sc query ViGEmBus >nul 2>&1
if not errorlevel 1 goto :vigem_ready

echo  ViGEmBus not detected. Downloading official installer...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://github.com/nefarius/ViGEmBus/releases/latest/download/ViGEmBus_Setup_x64.exe' -OutFile '%TEMP%\ViGEmBus_Setup.exe'"
if not exist "%TEMP%\ViGEmBus_Setup.exe" goto :vigem_download_failed

echo  Launching ViGEmBus installer...
start /wait "" "%TEMP%\ViGEmBus_Setup.exe"

echo  Re-checking ViGEmBus service...
sc query ViGEmBus >nul 2>&1
if errorlevel 1 goto :vigem_install_failed

:vigem_ready
echo  OK: ViGEmBus driver active

:: ── 3. Prepare C++ build tools + npm dependencies ───────────────────────────────
echo.
echo [3/6] Preparing C++ build tools and Node.js dependencies...
call :has_vctools
if not errorlevel 1 goto :cpp_ready

echo.
echo  The Microsoft C++ toolset required by vigemclient is missing.
echo  This is required because vigemclient contains native C++ code.
echo.
choice /C SN /N /M "  Install Visual Studio C++ Build Tools automatically now? [S/N]: "
if errorlevel 2 goto :cpp_declined

call :install_vctools
call :has_vctools
if errorlevel 1 goto :cpp_failed

:cpp_ready
echo  OK: Microsoft C++ build tools available

echo.
echo  Installing npm dependencies (vigemclient will compile natively)...
call npm install --no-fund --no-audit --foreground-scripts
if errorlevel 1 goto :npm_failed

if not exist "node_modules\vigemclient\build\Release\vigemclient.node" goto :native_missing

echo  OK: Dependencies installed and vigemclient native module built

:: ── 4. Generate SSL certificate ────────────────────────────────────────────────
echo.
echo [4/6] Generating SSL certificate...
if not exist ssl mkdir ssl

echo  Detecting LAN address(es) and generating the HTTPS certificate...
call node scripts\generate-cert.js
if errorlevel 1 goto :ssl_failed
echo  OK: Certificate generated and SAN verified for the current LAN IP(s)

:: ── 5. Open firewall port ──────────────────────────────────────────────────────
echo.
echo [5/6] Opening firewall port 8443...
netsh advfirewall firewall delete rule name="NULLPAD WSS" >nul 2>&1
netsh advfirewall firewall add rule ^
    name="NULLPAD WSS" ^
    dir=in action=allow protocol=TCP localport=8443 remoteip=LocalSubnet profile=any ^
    description="NULLPAD mobile gamepad WebSocket on local subnet" >nul 2>&1
if errorlevel 1 goto :firewall_failed
echo  OK: Firewall rule added (TCP 8443 inbound on LocalSubnet)

:: ── 6. Done ────────────────────────────────────────────────────────────────────
echo.
echo [6/6] Setup complete!
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  ViGEm native mode is ready          ║
echo  ║  Run start.bat to launch NULLPAD    ║
echo  ╚══════════════════════════════════════╝
echo.
pause
exit /b 0

:: ── Helpers ─────────────────────────────────────────────────────────────────────
:init_fnm
where fnm >nul 2>&1
if errorlevel 1 if exist "%APPDATA%\fnm\fnm.exe" set "PATH=%APPDATA%\fnm;%PATH%"
where fnm >nul 2>&1
if errorlevel 1 exit /b 0
if not defined FNM_AUTORUN_GUARD (
    set "FNM_AUTORUN_GUARD=1"
    for /f "tokens=*" %%z in ('fnm env --use-on-cd') do call %%z
)
exit /b 0

:has_vctools
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
set "VS_PATH="
if not exist "%VSWHERE%" exit /b 1
"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath >"%TEMP%\nullpad_vs_path.txt" 2>nul
if exist "%TEMP%\nullpad_vs_path.txt" (
    set /p "VS_PATH="<"%TEMP%\nullpad_vs_path.txt"
    del /q "%TEMP%\nullpad_vs_path.txt" >nul 2>&1
)
if defined VS_PATH exit /b 0
exit /b 1

:install_vctools
echo.
echo  Downloading Microsoft Visual Studio Build Tools...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -Uri 'https://aka.ms/vs/stable/vs_buildtools.exe' -OutFile '%VS_BOOTSTRAP%'"
if not exist "%VS_BOOTSTRAP%" exit /b 1

echo  Installing Desktop development with C++ workload...
start /wait "" "%VS_BOOTSTRAP%" --quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended
set "VS_RC=%errorlevel%"
del /q "%VS_BOOTSTRAP%" >nul 2>&1
if "%VS_RC%"=="0" exit /b 0
if "%VS_RC%"=="3010" exit /b 0

echo  Visual Studio installer returned code %VS_RC%.
exit /b 1

:node_missing
echo.
echo  ERROR: Node.js was not found in this Administrator CMD session.
echo  If you use fnm, make sure the desired Node version is installed and active.
echo  Download Node.js: https://nodejs.org/  (LTS recommended)
pause
exit /b 1

:vigem_download_failed
echo.
echo  ERROR: Could not download the ViGEmBus installer.
echo  Download manually: https://github.com/nefarius/ViGEmBus/releases
pause
exit /b 1

:vigem_install_failed
echo.
echo  ERROR: ViGEmBus is still not installed after the installer finished.
echo  Reboot Windows if the driver installer requested it, then run install.bat again.
pause
exit /b 1

:cpp_declined
echo.
echo  C++ Build Tools were not installed.
echo  vigemclient cannot compile without the Microsoft C++ toolchain.
echo  Run install.bat again and choose S when prompted.
pause
exit /b 1

:cpp_failed
echo.
echo  ERROR: Visual Studio C++ Build Tools could not be installed or detected.
echo  Open Visual Studio Installer and add:
echo    Desktop development with C++
echo  Then run install.bat again.
pause
exit /b 1

:npm_failed
echo.
echo  ERROR: npm install failed.
echo  The native vigemclient module did not compile.
echo  Make sure the C++ workload is installed, close any NULLPAD/node.exe process, and run install.bat again.
pause
exit /b 1

:native_missing
echo.
echo  ERROR: vigemclient installation completed but its native .node file is missing.
echo  This means the native C++ build did not complete correctly.
echo  Re-run install.bat after ensuring Desktop development with C++ is installed.
pause
exit /b 1

:ssl_failed
echo.
echo  ERROR: SSL certificate generation failed.
echo  The server requires ssl\cert.pem and ssl\key.pem.
pause
exit /b 1

:firewall_failed
echo.
echo  ERROR: Could not create the Windows Firewall rule for TCP 8443.
echo  Re-run install.bat as Administrator.
pause
exit /b 1
