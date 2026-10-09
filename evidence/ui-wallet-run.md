# Real-wallet run through the app (Phantom, devnet)

**Date:** 2026-10-09.

**Setup:**
- Phantom in Chrome, Testnet Mode set to Solana Devnet.
- Four separate Phantom accounts.
- Every transaction below was built by the EqualStart web app and approved by a person in Phantom. None were scripted.
- On-chain results were then checked independently with `app/scripts/verify-ui-run.ts`.

| Role | Address |
|---|---|
| Creator (also deposits) | [`9FvYgiyz3Zmyb7CrthVcuTw3Z6DFcn4X8yHtA5LeA1rp`](https://explorer.solana.com/address/9FvYgiyz3Zmyb7CrthVcuTw3Z6DFcn4X8yHtA5LeA1rp?cluster=devnet) |
| Bob | [`6bsT9SHc4R6RYSsgKjo3vYYKK8tLpiS3oQW1Gy7JLyrJ`](https://explorer.solana.com/address/6bsT9SHc4R6RYSsgKjo3vYYKK8tLpiS3oQW1Gy7JLyrJ?cluster=devnet) |
| Carol | [`8N1yZs5DemFVwdM4zQ1z425eUAm9BsGYUzNxed8TxZBG`](https://explorer.solana.com/address/8N1yZs5DemFVwdM4zQ1z425eUAm9BsGYUzNxed8TxZBG?cluster=devnet) |
| Settler (never deposits) | [`715B3SUPhreKRxZPxJp5eC2zy71WC3kPRg81V6zPqVyF`](https://explorer.solana.com/address/715B3SUPhreKRxZPxJp5eC2zy71WC3kPRg81V6zPqVyF?cluster=devnet) |

## 1. EqualStart Demo ($EQUAL): deposit → permissionless settle → claims

**Accounts and metadata:**
- Launch: [`BJDWdVWwgxrAjxabZdWXm2jyqkJwQBTAoduC2ToR5BXV`](https://explorer.solana.com/address/BJDWdVWwgxrAjxabZdWXm2jyqkJwQBTAoduC2ToR5BXV?cluster=devnet)
- Token mint: [`8r6XH3XMgXuXhMqdeHHfbWyEdqNb2dv1aeeLKqyfAa2M`](https://explorer.solana.com/address/8r6XH3XMgXuXhMqdeHHfbWyEdqNb2dv1aeeLKqyfAa2M?cluster=devnet)
- Metadata: [`equal.json`](https://equalstart.vercel.app/token/equal.json)

**Committed terms:**
- deposits open for 15 min, then 2 h to settle
- 0.5 SOL per-wallet cap
- 0.1 SOL minimum raise, 2 SOL batch cap
- opening fee ≤ 1%
- at least 10M EQUAL per SOL
- 0.03 SOL settler bounty

| Step | Signed by | Transaction |
|---|---|---|
| Create DBC config (default curve; the new config key co-signs) | Creator | [`2H2y5fxA…`](https://explorer.solana.com/tx/2H2y5fxAD8ZwKutMGKTpMK66Nn4LKnS9ageeoKhc4GdDPUM8WM9YKTwUi77aV3pLN9A8WobWyYe3feLFEtA7itAm?cluster=devnet) |
| Commit launch terms | Creator | [`67vYxvX8…`](https://explorer.solana.com/tx/67vYxvX8Vyek6MdnAvifZH2KNebsFt2qYf6cjH34X8xxJRbWh72r9nJGLcDivdK2Wag8EoDziUAA1gEkh3WeESt?cluster=devnet) |
| Deposit 0.3 SOL | Creator | [`3SA3FFXj…`](https://explorer.solana.com/tx/3SA3FFXjk3D2quQRkG7gGBc4HxGsXkquDSkk5Pj6KMXBUFfyD3tYjTQFJuBYfTsYxPxAAwHsdWooZaKdQfVDrdqh?cluster=devnet) |
| Deposit 0.1 SOL | Carol | [`4GkqrfQX…`](https://explorer.solana.com/tx/4GkqrfQX8S4nHmWLk8XRZZKUkVtC5quGJuZpkcT4zjPDkqxr54C66Ak2LhAMet8uwKQ1D2ArJ4MiY1k9V6Lj76MN?cluster=devnet) |
| Deposit 0.2 SOL | Bob | [`v5xfbE3V…`](https://explorer.solana.com/tx/v5xfbE3Vsu3fQ428NeYdMgDDaj9HjxujadXnrHvHXLZrTrQt1iKN8hWaCZxHozJoVtcafsdWzfr8kFi1nvyoMvf?cluster=devnet) |
| **Settle: create the Meteora pool + batch buy, in one instruction** | **Settler** | [**`3UZ6nanj…`**](https://explorer.solana.com/tx/3UZ6nanjMmX5T651n5LAXMHB9rFjHyJaZw1pPUyXJjiUP2Y8Zfvst991EWU7htXvojPQpQXXr5vJTeE1HbmHPhEB?cluster=devnet) |
| Claim | Bob | [`2FUwsyYZ…`](https://explorer.solana.com/tx/2FUwsyYZozoJ7NGRBsMAzzWMnjscb6sN5SjCuBoaYY3ewaDyheaf1suRS6MZEZ1VAyPrwZuNKXMkP5QtE3jB5gmT?cluster=devnet) |
| Claim | Creator | [`4bPnBo41…`](https://explorer.solana.com/tx/4bPnBo41eWnnwmXRtb3SVXEDdX7h43fikCCm8xU6vHuZkJ74WeuTgdeH6eG5ipVUb69S9tB5okhzhS72UTquPhb2?cluster=devnet) |
| Claim | Carol | [`23f26hBS…`](https://explorer.solana.com/tx/23f26hBSLRMt4qS8oQpRBht6eH2m8zmXHwqVid9Z9r21XmR7G9tV8n6WWNv1TsbDQZ4G84TSx3uXKxB2XJRc8oqe?cluster=devnet) |

**Result:** 0.6 SOL bought 19,453,340.776307 EQUAL, which is 32,422,235 EQUAL per SOL for every participant. That is the same figure the app's comparison measured on Meteora's mainnet DBC binary.

| Wallet | Deposit | Share | EQUAL in wallet after claim (raw) | `floor(19453340776307 × deposit ÷ 600000000)` |
|---|---|---|---|---|
| Creator | 0.3 SOL | 50.00% | 9,726,670,388,153 | 9,726,670,388,153 ✅ |
| Bob | 0.2 SOL | 33.33% | 6,484,446,925,435 | 6,484,446,925,435 ✅ |
| Carol | 0.1 SOL | 16.67% | 3,242,223,462,717 | 3,242,223,462,717 ✅ |

The three claims total 2 raw units less than the batch received. That rounding dust stays in the batch vault, where `burn_dust` can burn it.

## 2. EqualStart Refund Test ($REFUND): unsettled → expired → anyone cancels → refunds

**Accounts:**
- Launch: [`CugJXmU56pGHF9CBQX8Cki97GBdmYx9Viqmuepij3CU2`](https://explorer.solana.com/address/CugJXmU56pGHF9CBQX8Cki97GBdmYx9Viqmuepij3CU2?cluster=devnet)

**Committed terms:**
- deposits open for 3 min, then 1 min to settle
- minimum raise 0.05 SOL
- 0.01 SOL bounty

Nobody settled it.

| Step | Signed by | Transaction |
|---|---|---|
| Commit launch terms | Creator | [`2ub1ZN4r…`](https://explorer.solana.com/tx/2ub1ZN4rYJYQEGzcpLNNGArz7TeGUnVMzKfnCCViE3hymae2TxkmyZLYDzsg9uVmS6G2XCPQNgoZV9tkWhKEHCZj?cluster=devnet) |
| Deposit 0.05 SOL | Creator | [`4kVgJdJt…`](https://explorer.solana.com/tx/4kVgJdJt2hd7zKSWm7BUN9rmuphCbZXigFZVdgcMkgyGD3hf86RRa4PkTDRQpe3bhQKtBXtBL6EdCVsBRWzVRHLM?cluster=devnet) |
| Deposit 0.05 SOL | Bob | [`3HcWNHqb…`](https://explorer.solana.com/tx/3HcWNHqbQE3fwBm9CE1jAAGNv7cqbw5jw4Juhes8CqLWztYPZgjPk6VN4czj26nw9iNsgakFuav3Ao5dMMnx5S2P?cluster=devnet) |
| Cancel after expiry (the bounty returns to the creator, not the caller) | Settler | [`3kYimLRW…`](https://explorer.solana.com/tx/3kYimLRWB9KPt8wvDzyiEMcZgvXCTbwvrmwP4PLeEB5QMjiz76z1znWpsqffHDHASRQiJngc5vnMSv6AesxqZL5P?cluster=devnet) |
| Refund | Bob | [`5CRDzXfU…`](https://explorer.solana.com/tx/5CRDzXfU82STGHKWFKinCNjRPHxva4n26aEHmdD7nk7CbncUHdSkYuQ2XodfhtTAq2e2kAr3GCUTceU6yquJskov?cluster=devnet) |
| Refund | Creator | [`2jpX75Zk…`](https://explorer.solana.com/tx/2jpX75ZkeWHN2oQYwtysUu5iLibc2ZCsy9yw54Z7xzgTGwYMx7Sry5SMKiLkZ7t3PcCutPmrPTmc6mXHXQfkKiFV?cluster=devnet) |

**Balances around each refund:**
- Bob: 0.0962078 → 0.1476162 SOL
- Creator: 0.1981727 → 0.2495812 SOL

Both rose by the same 0.05140844 SOL. That is the 0.05 SOL deposit, plus the 0.00203928 SOL rent from closing the temporary wSOL account, minus the network fee Phantom set for the transaction.

## Wallet issues found and fixed during the run

1. **The wallet error message was useless.**
   - What happened: Bob switched Phantom accounts while a deposit was waiting for approval. Phantom aborted the deposit, and the app showed only "Deposit failed: Unexpected error". No transaction was sent and Bob's balance was unchanged.
   - Fix: wallet-side failures now say that nothing was sent, explain the likely cause, and suggest retrying. Rejections, expired blockhashes and insufficient funds also get specific messages. A retry, approved without switching, succeeded.
2. **A transaction notice leaked between launches.**
   - What happened: after settling one launch, "Settle confirmed" was still showing on the next launch's page.
   - Fix: launch pages are now keyed by address, so their state resets.
3. **Labels on cancelled launches were wrong.**
   - What happened: the bounty showed as "paid out" when it had actually been returned to the creator, and the allocation table still said "tokens at settlement".
   - Fix: both now describe refunds.

**Confirmed working with Phantom:**
- the connect flow
- switching accounts (accounts that haven't approved the site disconnect cleanly; approved ones switch over directly)
- a transaction with an extra signer (the DBC config)
- the settle transaction (191,142 CU)
- confirmation tracking
