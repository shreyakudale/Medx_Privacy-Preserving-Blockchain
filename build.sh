#!/usr/bin/env bash
# Compiles the circuit, runs a local Groth16 setup, exports the Solidity
# verifier to the blockchain package and the proving files to the frontend.
#
# NOTE: the powers-of-tau ceremony below is generated locally and is only
# suitable for development/demo. For anything real, download a public
# ceremony file (e.g. the Hermez/Polygon powersOfTau28_hez_final_13.ptau).
set -euo pipefail
cd "$(dirname "$0")/.."

SNARKJS="npx snarkjs"
NAME=medicalClaim
BUILD=build
PTAU=$BUILD/pot13_final.ptau

mkdir -p $BUILD

echo "==> Compiling circuit"
circom src/$NAME.circom --r1cs --wasm --sym -o $BUILD

$SNARKJS r1cs info $BUILD/$NAME.r1cs

if [ ! -f "$PTAU" ]; then
  echo "==> Powers of tau (local dev ceremony)"
  $SNARKJS powersoftau new bn128 13 $BUILD/pot13_0000.ptau
  $SNARKJS powersoftau contribute $BUILD/pot13_0000.ptau $BUILD/pot13_0001.ptau \
    --name="dev contribution" -e="$(head -c 64 /dev/urandom | base64)"
  $SNARKJS powersoftau prepare phase2 $BUILD/pot13_0001.ptau $PTAU
  rm -f $BUILD/pot13_0000.ptau $BUILD/pot13_0001.ptau
fi

echo "==> Groth16 setup"
$SNARKJS groth16 setup $BUILD/$NAME.r1cs $PTAU $BUILD/${NAME}_0000.zkey
$SNARKJS zkey contribute $BUILD/${NAME}_0000.zkey $BUILD/${NAME}_final.zkey \
  --name="dev phase2" -e="$(head -c 64 /dev/urandom | base64)"
rm -f $BUILD/${NAME}_0000.zkey
$SNARKJS zkey export verificationkey $BUILD/${NAME}_final.zkey $BUILD/verification_key.json

echo "==> Exporting Solidity verifier"
$SNARKJS zkey export solidityverifier $BUILD/${NAME}_final.zkey ../blockchain/contracts/Groth16Verifier.sol

echo "==> Copying proving artifacts to frontend"
mkdir -p ../frontend/public/zk
cp $BUILD/${NAME}_js/${NAME}.wasm ../frontend/public/zk/
cp $BUILD/${NAME}_final.zkey ../frontend/public/zk/
cp $BUILD/verification_key.json ../frontend/public/zk/

echo "Done."
