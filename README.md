# EqualStart

**Pool SOL into one opening buy, shared equally.**

Participants deposit SOL into a program-owned escrow before the token exists. When the deposit window closes, anyone can settle. One EqualStart instruction then:
1. creates the Meteora Dynamic Bonding Curve (DBC) pool, and
2. spends the whole batch on its very first buy.

Nobody can trade ahead of the batch. Everyone in it gets the same average price and claims tokens in proportion to their deposit. If nobody settles before the deadline, anyone can cancel the launch and every participant gets a full refund. The creator has no special power after committing the terms.

> **Status:** hackathon prototype, deployed on Solana **devnet** only. **Unaudited.** Do not use with real funds. Any mainnet use requires independent security review first.

## Verify it yourself

| What | Where |
|---|---|
| Live app (devnet; explore without a wallet) | https://equalstart.vercel.app |
| Submission: architecture diagram, video script | [`SUBMISSION.md`](SUBMISSION.md) |
| Public devnet run (10/10), with explorer links for every deposit, the settlement, the claims, the refunds and each rejected attack | [`VERIFICATION.md`](VERIFICATION.md) |
| Settlement transaction (devnet), signed by a wallet with no role in the launch | [`3mPebdq9…`](https://explorer.solana.com/tx/3mPebdq9aesrtS28sEaRJqXjMwM54BkXbotfGugknUVVQUwUdo46s2iXtubUWojGGy5VRaLnJgb2wccHSbatkN7t?cluster=devnet) |
| Program (devnet) | [`6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j`](https://explorer.solana.com/address/6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j?cluster=devnet); the deployed bytes match the local build |
| Design, guarantees, test matrix, limitations | [`ONCHAIN_RESULTS.md`](ONCHAIN_RESULTS.md) |
| Raw evidence: signatures, full logs, compute units, balances | [`evidence/`](evidence/) |

## How the opening batch works

```
initialize_batch   creator commits terms (immutable): DBC config, deadlines, caps, fee ceiling, minimum price, bounty
deposit/withdraw   participants move wSOL into a PDA vault (withdrawals allowed only until close)
settle             ANYONE, once deposits close:
                     DBC InitializeVirtualPoolWithSplToken   (mint and creator are EqualStart PDAs, so nobody else can create this pool)
                     DBC Swap2 ExactIn (whole batch)         (the first trade the pool ever sees)
                     DBC TransferPoolCreator -> creator
                     settler receives the creator-funded bounty
claim              each participant: floor(tokens_received × deposit ÷ total)
cancel_expired     ANYONE, after expiry if unsettled → refund: each participant gets back exactly what they deposited
```

## Repository

| Path | Contents |
|---|---|
| `onchain/programs/equalstart/src/lib.rs` | Anchor program |
| `onchain/tests/equalstart.ts` | On-chain test suite: runs on localnet with the real DBC binaries, or on public devnet |
| `onchain/scripts/devnet.sh` | Deploys to devnet, runs the suite and writes `VERIFICATION.md` |
| `app/` | Web app: create a launch, deposit, watch progress, settle, claim, refund (`npm run dev`) |
| `settlement.mjs`, `CHAIN_FEASIBILITY.md` | Original offchain accounting model (12 tests, `npm test`) and feasibility notes |

## Run

```bash
# Program + tests (Agave 4.3.0, anchor-cli 1.2.1, Node 22)
cd onchain && npm install && anchor build
scripts/localnet.sh &     # local validator loaded with Meteora's mainnet DBC bytecode
NODE_OPTIONS=--no-experimental-strip-types npx ts-mocha -p ./tsconfig.json -t 1000000 tests/equalstart.ts

# App (devnet by default; set VITE_CLUSTER=localnet and VITE_RPC_URL for local)
cd app && npm install && npm run dev
```

## Known limitations

- **Unaudited.** This is a prototype.
- **Upgrade authority.** The devnet program is upgradeable by a throwaway key, which could change its behaviour. A trustless deployment needs the authority revoked, or held by a disclosed multisig with a timelock.
- **Depends on Meteora DBC.** EqualStart hard-codes DBC's instruction layouts and account byte offsets from IDL 0.2.1. Meteora can upgrade DBC; a layout change could break or mislead the checks. While settling, the escrow's address signs for DBC, so a malicious DBC upgrade is outside EqualStart's control. Balance checks before and after the swap limit the damage but can't rule it out.
- More detail is under "Remaining security concerns" in `ONCHAIN_RESULTS.md`.
