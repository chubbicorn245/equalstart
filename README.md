<h1 align="center">EqualStart</h1>
<p align="center"><strong>One opening buy. One blended entry price. No race to be first.</strong></p>
<p align="center">A permissionless fair-opening mechanism for <a href="https://docs.meteora.ag/developer-guides/dbc">Meteora Dynamic Bonding Curve</a> launches on Solana.</p>

<p align="center">
  <a href="https://superteam.fun/earn/hackathon/crypto-worlds-fair/"><img alt="Meteora DBC Hackathon" src="https://img.shields.io/badge/Meteora-DBC%20Hackathon-7C3AED?style=for-the-badge" /></a>
  <a href="https://superteam.fun/earn/hackathon/crypto-worlds-fair/"><img alt="Crypto World's Fair 2026" src="https://img.shields.io/badge/Crypto%20World%27s%20Fair-2026-1F2937?style=for-the-badge" /></a>
  <a href="https://equalstart.vercel.app"><img alt="Live demo on Solana devnet" src="https://img.shields.io/badge/Live%20Demo-Devnet-14B8A6?style=for-the-badge" /></a>
</p>
<p align="center">
  <img alt="Anchor" src="https://img.shields.io/badge/Anchor-Rust-0F172A?style=flat-square" />
  <img alt="Meteora DBC" src="https://img.shields.io/badge/Powered%20by-Meteora%20DBC-0F766E?style=flat-square" />
  <img alt="Devnet tests passed" src="https://img.shields.io/badge/Devnet%20Tests-10%2F10%20Passed-15803D?style=flat-square" />
  <img alt="Unaudited" src="https://img.shields.io/badge/Security-Unaudited-F59E0B?style=flat-square" />
</p>
<p align="center">
  <a href="https://equalstart.vercel.app"><strong>Live App</strong></a> ·
  <a href="VERIFICATION.md"><strong>Onchain Verification</strong></a> ·
  <a href="evidence/ui-wallet-run.md"><strong>Wallet Walkthrough</strong></a> ·
  <a href="SUBMISSION.md"><strong>Hackathon Submission</strong></a>
</p>

> [!WARNING]
> **Devnet prototype only.** Unaudited and upgradeable. Do not use with real funds. Mainnet use requires independent security review and a production upgrade-authority policy.

## Why EqualStart?

With an ordinary rising bonding curve, the fastest buyers typically get better entry prices. EqualStart removes that **transaction-order advantage within the opening batch** without replacing Meteora's price discovery.

| Typical DBC launch | EqualStart opening batch |
| --- | --- |
| Traders race to be the first buyer | Participants deposit during a fixed window |
| Earlier swaps have an entry-price advantage | Every batch member gets the same **blended price** |
| Creator may have to coordinate the launch | **Any wallet** can trigger settlement |
| Separate buys move the curve one after another | **One atomic first buy** executes for the full batch |

**Example:** Alice commits 0.1 SOL, Bob 0.2 SOL, and Carol 0.3 SOL. EqualStart purchases with all 0.6 SOL. They claim **16.67%, 33.33%, and 50%** of the tokens acquired, respectively, subject to token-unit rounding. The price is equalized, **not** the number of tokens.

## The mechanism

```text
 Creator commits DBC config, deadlines, limits, and settlement bounty
                             |
                    Deposit window
                Participants escrow wSOL
                             |
                    Window closes
                             |
               ANY wallet calls settle
                             |
           One atomic EqualStart instruction
                 + Create DBC pool
                 + Execute pooled first buy
                 + Transfer pool-creator role
                 + Pay settlement bounty
                             |
              Participants claim tokens
```

- **No front-running the batch:** Token mint and pool-creator authorities are EqualStart PDAs. Only the program can sign to create the committed pool.
- **Permissionless and atomic:** Settlement does not require the creator's signature. If the purchase fails its checks, the transaction rolls back.
- **Proportional claims:** `floor(tokens_received × participant_deposit / total_deposits)`, enforced onchain, with double claims rejected.
- **Recoverable deposits:** If a batch isn't settled before its deadline (for example because it missed its minimum raise), anyone can cancel it and every participant can reclaim exactly what they deposited.
- **Normal market afterward:** DBC trading proceeds under the committed configuration, including its configured graduation path.

EqualStart does **not** prevent whales using multiple wallets, post-launch selling, or price declines. Its fairness guarantee is specifically about **opening-batch execution price**, not future market outcomes.

## Try it and verify it

| | Evidence |
| --- | --- |
| **Live application** | [equalstart.vercel.app](https://equalstart.vercel.app) (browse without a wallet) |
| **Real-wallet flow** | [`evidence/ui-wallet-run.md`](evidence/ui-wallet-run.md): Phantom deposits, unrelated-wallet settlement, claims, refunds |
| **Public devnet tests** | [`VERIFICATION.md`](VERIFICATION.md): 10/10 test groups, 54 linked transactions, rejected-attack evidence |
| **Atomic settlement** | [Solana Explorer transaction](https://explorer.solana.com/tx/3mPebdq9aesrtS28sEaRJqXjMwM54BkXbotfGugknUVVQUwUdo46s2iXtubUWojGGy5VRaLnJgb2wccHSbatkN7t?cluster=devnet) (reported 218,120 compute units) |
| **Deployed program** | [Solana Explorer program](https://explorer.solana.com/address/6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j?cluster=devnet) (deployed bytes match the local build) |
| **Design and limitations** | [`ONCHAIN_RESULTS.md`](ONCHAIN_RESULTS.md) |
| **Raw evidence** | [`evidence/`](evidence/) (signatures, logs, balances) |
| **Submission materials** | [`SUBMISSION.md`](SUBMISSION.md) (architecture diagram and video script) |

## Repository and development

| Path | Purpose |
| --- | --- |
| `onchain/programs/equalstart/src/lib.rs` | Anchor program: escrow, DBC CPIs, settlement, claims, refunds |
| `onchain/tests/equalstart.ts` | Localnet and public-devnet onchain test suite |
| `onchain/scripts/devnet.sh` | Devnet deploy and verification harness |
| `app/` | Web application |
| `settlement.mjs` and `CHAIN_FEASIBILITY.md` | Original 12-test accounting model and feasibility notes |

**Prerequisites:** Agave 4.3.0, Anchor CLI 1.2.1, Node.js 22, and Meteora DBC binaries for the local validator.

```bash
# Build and run program tests (from repository root)
cd onchain
npm install
anchor build
scripts/localnet.sh &
NODE_OPTIONS=--no-experimental-strip-types \
  npx ts-mocha -p ./tsconfig.json -t 1000000 tests/equalstart.ts
```

In another terminal, from the repository root:

```bash
cd app
npm install
npm run dev
```

The app uses **devnet by default**; for localnet, set `VITE_CLUSTER=localnet` and `VITE_RPC_URL`. Reproduction details and explorer links are in [`VERIFICATION.md`](VERIFICATION.md).

## Security and known limitations

- **Unaudited:** Localnet and devnet tests do not replace an independent security audit.
- **Upgrade authority:** A throwaway key currently controls the devnet program. A production release needs an explicit multisig/timelock or revoked-upgrade strategy.
- **Meteora dependency:** The implementation relies on DBC instruction layouts and account offsets from IDL `0.2.1`. A future DBC upgrade could invalidate these assumptions. The DBC program is part of the settlement trust boundary; balance checks limit but cannot eliminate the resulting risk.
- **Scope:** Per-wallet caps are not Sybil resistance, and equalized opening pricing does not guarantee token value or liquidity.

See [`ONCHAIN_RESULTS.md`](ONCHAIN_RESULTS.md) for detailed security notes.

---
<p align="center">
  <strong>Built for the 2026 Crypto World's Fair</strong><br />
  <a href="https://superteam.fun/earn/hackathon/crypto-worlds-fair/">Meteora: Best use of Dynamic Bonding Curve (DBC)</a><br />
  <sub>Fairer opening participation, powered by Meteora DBC.</sub>
</p>
