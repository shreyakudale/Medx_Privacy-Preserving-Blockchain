@echo off
setlocal enableextensions
title MedZK One-Click Launcher
cd /d "%~dp0"

echo ===================================================
echo           Starting MedZK (local development)
echo ===================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 18 or newer is required. Install it from https://nodejs.org and run this again.
  pause
  exit /b 1
)

echo [1/6] Starting MongoDB with Docker...
where docker >nul 2>nul
if errorlevel 1 (
  echo [WARN] Docker was not found. MongoDB must already be running on port 27017.
) else (
  docker compose up -d
  if errorlevel 1 (
    echo [ERROR] "docker compose up -d" failed. Start Docker Desktop and run this again.
    pause
    exit /b 1
  )
)

echo [2/6] Preparing configuration...
if not exist "backend\.env" (
  copy /y "backend\.env.example" "backend\.env" >nul
  echo Created backend\.env from the example. Local placeholders are fine for development.
)

echo [3/6] Installing dependencies if missing (first run takes a few minutes)...
for %%D in (blockchain backend frontend) do (
  if not exist "%%D\node_modules" (
    echo Installing %%D ...
    call npm install --prefix "%%D"
    if errorlevel 1 (
      echo [ERROR] npm install failed in %%D. Check your internet connection.
      pause
      exit /b 1
    )
  )
)

echo [4/6] Starting the local blockchain node...
start "MedZK Blockchain Node" cmd /k "cd /d %~dp0blockchain && npx hardhat node"

echo Waiting for the node to answer on http://127.0.0.1:8545 ...
set /a tries=0
:waitnode
node -e "fetch('http://127.0.0.1:8545',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})}).then(function(){process.exit(0)}).catch(function(){process.exit(1)})" >nul 2>nul
if not errorlevel 1 goto nodeready
set /a tries+=1
if %tries% geq 60 (
  echo [ERROR] The blockchain node did not start. Look at the "MedZK Blockchain Node" window for the error.
  pause
  exit /b 1
)
timeout /t 2 /nobreak >nul
goto waitnode
:nodeready

echo [5/6] Deploying contracts and seeding the demo hospital...
call npm run deploy:local --prefix blockchain
if errorlevel 1 (
  echo [ERROR] Contract deployment failed.
  pause
  exit /b 1
)
call npm run seed:local --prefix blockchain
if errorlevel 1 (
  echo [ERROR] Seeding failed. Is MongoDB running? Read the message above.
  pause
  exit /b 1
)

echo [6/6] Starting the backend (port 4000) and the web app (port 5173)...
start "MedZK Backend Gateway" cmd /k "cd /d %~dp0backend && npm run dev"
start "MedZK Frontend (Vite)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo ===================================================
echo  Web app:   http://localhost:5173
echo  Backend:   http://localhost:4000/api/health
echo  Chain RPC: http://127.0.0.1:8545  (chain id 31337)
echo ===================================================
echo In MetaMask add the network above and import the test accounts listed by the seed step.
echo If you restart the blockchain node, run this file again (it redeploys the contracts).
timeout /t 6 /nobreak >nul
start http://localhost:5173
endlocal
