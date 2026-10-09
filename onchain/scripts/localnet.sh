#!/usr/bin/env bash
# Local validator with the REAL Meteora DBC program (mainnet dump) and Metaplex
# Token Metadata, plus the freshly built EqualStart program.
#   DBC_SO=../fixtures/dbc_devnet.so scripts/localnet.sh   # to test the devnet build instead
set -euo pipefail
cd "$(dirname "$0")/.."
FIX=../fixtures
DBC_SO="${DBC_SO:-$FIX/dbc_mainnet.so}"
LEDGER="${LEDGER:-${TMPDIR:-/tmp}/equalstart-ledger}"
exec solana-test-validator --reset --quiet --ledger "$LEDGER" \
  --bpf-program dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN "$DBC_SO" \
  --bpf-program metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s "$FIX/mpl_token_metadata.so" \
  --bpf-program 6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j target/deploy/equalstart.so
