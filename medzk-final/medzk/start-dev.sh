#!/usr/bin/env bash
# One-command local start for macOS / Linux. Windows users: run start-dev.bat instead.
set -euo pipefail
cd "$(dirname "$0")"

command -v node >/dev/null || { echo "Node.js 18+ is required: https://nodejs.org"; exit 1; }

echo "[1/6] MongoDB"
if command -v docker >/dev/null; then docker compose up -d; else echo "Docker not found: MongoDB must already be running on 27017."; fi

echo "[2/6] Configuration"
[ -f backend/.env ] || { cp backend/.env.example backend/.env; echo "Created backend/.env from the example (local placeholders are fine for development)."; }

echo "[3/6] Dependencies"
for d in blockchain backend frontend; do [ -d "$d/node_modules" ] || npm install --prefix "$d"; done

echo "[4/6] Blockchain node"
mkdir -p .run
(cd blockchain && npx hardhat node > ../.run/node.log 2>&1) &
NODE_PID=$!
trap 'kill $NODE_PID ${BACKEND_PID:-} ${FRONT_PID:-} 2>/dev/null || true' EXIT INT TERM
for i in $(seq 1 60); do
  node -e "fetch('http://127.0.0.1:8545',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'eth_blockNumber',params:[]})}).then(()=>process.exit(0)).catch(()=>process.exit(1))" && break
  sleep 2
  [ "$i" = 60 ] && { echo "Node did not start. See .run/node.log"; exit 1; }
done

echo "[5/6] Deploy and seed"
npm run deploy:local --prefix blockchain
npm run seed:local --prefix blockchain

echo "[6/6] Backend and web app"
(cd backend && npm run dev) & BACKEND_PID=$!
(cd frontend && npm run dev) & FRONT_PID=$!
echo
echo "Web app: http://localhost:5173   Backend: http://localhost:4000/api/health   Chain: http://127.0.0.1:8545 (31337)"
echo "Press Ctrl+C to stop everything."
wait
