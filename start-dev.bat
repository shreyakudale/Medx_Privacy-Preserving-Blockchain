@echo off
title MedZK One-Click Launcher
echo ===================================================
echo           Starting MedZK Full-Stack Network
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/4] Starting Local Hardhat Blockchain Node...
start "MedZK Blockchain Node" cmd /k "cd /d %~dp0blockchain && npx hardhat node"

echo Waiting 5 seconds for blockchain node to initialize...
timeout /t 5 /nobreak >nul

echo [2/4] Deploying Smart Contracts to Local Network...
call cmd /c "cd /d %~dp0blockchain && npm run deploy:local"
if %errorlevel% neq 0 (
    echo [ERROR] Contract deployment failed. Make sure the blockchain node is running.
    pause
    exit /b %errorlevel%
)
echo Contracts deployed successfully!
echo.
echo Seeding Demo Roles and Sample Records...
call cmd /c "cd /d %~dp0blockchain && npm run seed:local"
echo Demo roles initialized!
echo.

echo [3/4] Starting MedZK Backend Gateway (Port 4000)...
start "MedZK Backend Gateway" cmd /k "cd /d %~dp0backend && npm run dev"

echo [4/4] Starting MedZK Frontend Application (Port 5173)...
start "MedZK Frontend (Vite)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ===================================================
echo All services launched! Opening application in browser...
echo Frontend: http://localhost:5173
echo Backend:  http://localhost:4000
echo RPC Node: http://127.0.0.1:8545
echo ===================================================
timeout /t 3 /nobreak >nul
start http://localhost:5173
