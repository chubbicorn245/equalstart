#!/usr/bin/env bash
# Deploy EqualStart to public devnet and run the full onchain suite against the
# live devnet Meteora DBC program. Needs ~7 devnet SOL in keys/deployer.json:
# ~2.5 SOL program rent + ~3.9 SOL funding for the test wallets.
#   solana address -k ../keys/deployer.json   # fund this address first
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/share/solana/install/active_release/bin:$HOME/.cargo/bin:$PATH"
RPC="${RPC_URL:-https://api.devnet.solana.com}"
DEPLOYER=../keys/deployer.json
PROGRAM_KP=../keys/equalstart-program-keypair.json

echo "deployer $(solana address -k $DEPLOYER): $(solana -u "$RPC" balance -k $DEPLOYER)"
if [ "${SKIP_DEPLOY:-0}" != 1 ]; then
  solana program deploy -u "$RPC" -k "$DEPLOYER" --program-id "$PROGRAM_KP" \
    --upgrade-authority "$DEPLOYER" target/deploy/equalstart.so
fi
solana program show -u "$RPC" "$(solana address -k $PROGRAM_KP)"

RPC_URL="$RPC" CLUSTER=devnet FUNDER_KEYPAIR="$DEPLOYER" EVIDENCE_NAME=devnet-run.json \
  NODE_OPTIONS=--no-experimental-strip-types \
  npx ts-mocha -p ./tsconfig.json -t 3000000 tests/equalstart.ts 2>&1 | tee ../evidence/devnet-run.txt
node scripts/verification.mjs ../evidence/devnet-run.json > ../VERIFICATION.md && echo "wrote VERIFICATION.md"
