# EqualStart: onchain results (2026-10-08)

**Verdict: PASS on localnet with the real Meteora DBC program binaries; public devnet run NOT performed (faucet rate-limited, no funds).**

A PDA-controlled escrow executed the first DBC buy, through a PDA-signed `swap2` CPI, atomically in the same transaction that created the pool. The pool was built with SDK 1.5.13.
The DBC program used is the exact bytecode deployed at `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN`, dumped from mainnet (and separately devnet). It is not a mock or adapter. Both binaries pass the same 10-test suite.

Caveat: localnet signatures cannot be looked up on a public explorer. They are reproducible by re-running, and full logs are saved in `evidence/`.

## Pinned versions

| Component | Version |
|---|---|
| `@meteora-ag/dynamic-bonding-curve-sdk` | 1.5.13 (exact) |
| DBC IDL (bundled in SDK) | 0.2.1, saved to `idl/dynamic_bonding_curve.json` |
| DBC source cross-checked | MeteoraAg/dynamic-bonding-curve @ f552f20 (Cargo 0.2.1, Anchor 1.0.2) |
| DBC mainnet binary | sha256 `4c26a8a5…f23b`, 2,326,577 B (`fixtures/dbc_mainnet.so`) |
| DBC devnet binary | sha256 `5edf76d9…8ad3`, 1,983,568 B (`fixtures/dbc_devnet.so`) |
| Anchor (lang/spl/cli/TS client) | 1.2.1 |
| Agave / solana-test-validator | 4.3.0 |
| EqualStart program id (local) | `6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j` |

`swap2` schema (IDL 0.2.1): accounts `pool_authority, config, pool(w), input_token_account(w), output_token_account(w), base_vault(w), quote_vault(w), base_mint, quote_mint, payer(signer), token_base_program, token_quote_program, referral_token_account(w, optional), event_authority, program`; args `SwapParameters2 { amount_0: u64, amount_1: u64, swap_mode: u8 }` (0 = ExactIn: amount_in / min_out).
`payer` is the only signer and the transfer authority of `input_token_account`, so the batch PDA is `payer`, signed with `invoke_signed`.

## Settlement transaction (mainnet DBC binary)

`4E5mGR7EW3PRGZuv5NJQdxUMGDpNrXXuB9GTRTanJe19KfWMfUEyadz46fByRfzke9ryyC6LUQg9LFv8sbgsqJ5y`

```
ix0 ComputeBudget                                   invoke [1]
ix1 DBC InitializeVirtualPoolWithSplToken (SDK)      invoke [1]
ix2 EqualStart ExecuteBatch                          invoke [1]
      DBC Swap2  (payer = batch PDA, invoke_signed)  invoke [2]
        SPL Token transfers                          invoke [3]
      "EqualStart settled: quote_spent=600000000 base_received=19453340776307"
```

- Simulated first: 168,317 CU (mainnet binary) / 183,813 CU (devnet binary). The transaction is 932 of 1,232 bytes with 20 static account keys, and needs no ALT.
- Pool state after: `has_swap=1`, `quote_reserve=594000000` (0.6 SOL minus the 1% fee), config and base mint match the commitment.
- The only successful transaction ever touching the pool address is the settlement transaction (`getSignaturesForAddress`).
- Batch quote vault went 600,000,000 → 0 (exact-in fully consumed); base vault received 19,453,340,776,307 raw units.
- Devnet-binary settlement: `5KrrDACsRCJwVZDJv9kNehkugRwXJvhNP3EMKSHc9YM7J99sQtrXycLpDBYsEJVcqXCwv5r29pvkhXjsKZMYKjNd`.

Claims (1:2:3): Alice 3,242,223,462,717 · Bob 6,484,446,925,435 · Carol 9,726,670,388,153. All are exact floors. 2 raw units of dust were burned permissionlessly after all three claims.
Refunds (expired batch, cancelled by an unrelated wallet): Alice 0.05, Bob 0.10, Carol 0.15 wSOL, exactly 1:1.

## All transactions (mainnet DBC binary run)

Each `ATTACK` was sent with `skipPreflight`, landed on-chain as a failed transaction, and the test asserted the specific error.

| Step | Result | Signature |
|---|---|---|
| dbc.create_config (SDK) | OK | `rcxVV9z8T2eM9bvWpJBKUYVMMa5MZR8SfTeGjkXQ9YgNT8VGCGGRSE53a6fNmyesg3njazRXbjD8wgMkg462mhh` |
| initialize_batch main | OK | `3Gd1P8dztdAH4yxHGYQMo7pG9Yvot3CZCrcji5NCFJLkUF9G1BVGz71zGtpBS5e43j5fsPKDmhcExbdztXQBD2cS` |
| initialize_batch expiring | OK | `HFoLb9AxQpZiFg6o9guZex6HSdURaCFbSeSE5vLu62mHn9ySr3SJ2X2C8E5urSzosW9Sa71EtGryUFtJKfYZC4V` |
| initialize_batch slippage (min_base_out = u64::MAX/2) | OK | `8NZMwQAkFsQUtMb3DH6WCK94Bx6wxXQ4Gs18H5SfVZkzFHAWYVAeZjybLWFYAn2AkTm1uyZ3jbkc86iJKk3kpyA` |
| ATTACK re-initialize main batch with new terms | FAILED (account already in use) | `2RByf1Hh6Qdf8CiRPMAU794bu4C7rdqUNCMLyBLFQzokUXgNYWmWifGWZdnaKp4xdvs5uoLGFWKbGm2otksfL7QU` |
| ATTACK initialize_batch with non-DBC config | FAILED (InvalidDbcConfig) | `2J1csYVTw88EE9ugv5TnDMWdyQHxSBSZRnkxkNPHToiZCZipjVh43UBfprKGXmzzWvbUEwK1jv8bA7nibhUvnb1F` |
| ATTACK initialize_batch with max_pool_quote_in >= DBC migration threshold | FAILED (BadTerms) | `iKoAN5VXvPGnj4FfaVrV3r4DRAPyn2HKc1FDHDuaeQXxiZCA7xUtRcEV41BztpeGyna2Aiqo11kwKBcc4jrKV43` |
| wrap 1 SOL | OK | `5rBAbvaY9oSKkGoKZ2SVPNBXgM2LzxvsZVExaZu9WaZeTxbXtpbRPMtuv3EB27sNovbHwkWLuf6efJu69G4RAtwP` |
| wrap 1 SOL | OK | `4zMpjH5ewBbU2RaqkV2N3Tai99qLBSJKez5YjDxsQrQR676gUdUxPqNSmyTjo6DMmjZ3gAQaDqhRVhWzJbocmCja` |
| wrap 1 SOL | OK | `6762JFZPWRM8dP7bEPeYSqsS8ig4hAagZn9YWyi6w2mNWRhhBWQCuVCP7NzWApcmPN3bb9AZ7gYudk5SHd1zZzBu` |
| deposit alice 0.15 (main) | OK | `4o368isN4BcHUZX3uFdKoAthcRSz467jB1mu3nwD1UR66AGxRQkyCMMEE3K7KfJeXTLf3L7ZAJta9dyDvoBJmQf3` |
| withdraw alice 0.05 before close (main) | OK | `3dQJeJUK3zV1KFVkhNcG9SwYNRQgxFVUpGJUcXX9yzPUnCUjvGXJBwuwsMBhmeA9YfPPoMgJ2AqLUuK1di7p4Smc` |
| deposit bob 0.2 (main) | OK | `3msUxgZeWk8SkhL7V2NoQjYxcd4exm9yRgKgVHX7qJtvof39m33WdK1bufvcdF5N2u8MSiX1Qy2RmUqUJMEC5Bjs` |
| deposit carol 0.3 (main) | OK | `H2dpco2f4oxU2vLAGjim6HuDQm8JweyGgwtA96FuLgjDLxNfYSfLsUerUJMUKzMdsxG8crj5uSvp9gaUkBR8pBG` |
| deposit alice 0.05 (expiring) | OK | `3mbhwtSMBDwgqcoQPn8H8q9iFu1SuFk5KHyXHT812zxvg2fG5THmsMUpBSyBAtDY9HKNfYvDgPcdy7w7nPRMCFvS` |
| deposit bob 0.1 (expiring) | OK | `2xJ3GE8H7ZAbYM3oSCuLcCrnABpo2NCg5h1FtY5iYmJTh7jfw3DHMe9PjdXaotpRpQHNTTAQE4HzqkbpRKwsSSn4` |
| deposit carol 0.15 (expiring) | OK | `3hZZj4VuqLnfRbqZgmoHHCjdZnvucDcXmNcXPFB6zLR8xhtwcZSRyvsApUvaCcMUyHT42T6xwgk1KwvKbfbxEFD` |
| deposit alice 0.1 (slippage) | OK | `5hKze2S4Vb7ftTPTUQiD4yaaaJB5hw5LGQ2M7V8EnYnJ6Go5NWg8eWv4sJhGP1UbNoMYcvzoXMcvoayNqeNVh4Am` |
| ATTACK refund before cancellation | FAILED (NotCancelled) | `3Dd3LtvJPbH1uJ8dv2zPy9V6CJJNrPZLF5HPGS2fZXHfjxPRBSLEcdrKm9q6ZPjocpLd3Dro8HzxaQvQR33N4fKJ` |
| ATTACK cancel_expired before expiry | FAILED (NotExpired) | `rW5vG6uB3r8pDS3rteuH18kH5VEG9h3SsZzS49qB39pC1gWYt4nHT6zoFg1Zoz4sWxLFN4KnV5kHEz997bX2mYG` |
| ATTACK carol exceeds per-wallet cap | FAILED (WalletCapExceeded) | `616TGnxJkfwgSBuzjYtxfi7iDcWnREYZcuphM37Sx6p2QQgFL6ZuhGXVGJimufEeaGyCUQJ4q9kt14gSm6ua9ujW` |
| ATTACK eve withdraws from alice's contribution | FAILED (ConstraintSeeds) | `2XeE8V2zDLFEFLNqMvrjbKLd4QHUGLkBjjQ1gwbAoTaV8Q29SWEHNwagNDFrukmVyC8Y1natqagJrFvwokkeAGaL` |
| ATTACK creator SPL-transfers out of PDA quote vault | FAILED (owner does not match) | `2CazypCZBFVnk2jLa4qZkvzPqzgAJjF1oPDY55cRLM2kNyE7YLeFytmovtnRBknJ1jBhzjPXEyuM5yGVdsWTkj62` |
| ATTACK execute_batch before closes_at (with real pool init) | FAILED (NotInSettlementWindow) | `25MZ4iJYBuYrTuiZmEZXghYS8BLHEAD5JDG3EXda8prfceu1MUTGT3DPt8z9Rti5xEzFwz7CNMPZQcgnwoMgJMKL` |
| ATTACK execute_batch without pool init | FAILED (AccountNotInitialized) | `352X1rEpDHswGEV3tt9uX4ys8c58Z9iWKj6xGxype9KNepZQbwJuMrHYd4q2cyYMp3Fko6sMz6w2oU3SfY8QhcFf` |
| wrap eve 1 SOL | OK | `4fb5GberYU9uRDkePcxbcGtLxR4tAchfvfo155FxHLe1jVb42YAaB3D4ULpLM7Y9PYpPA2ZqvYDbukqL9sNEjvCV` |
| ATTACK init -> eve swap2 first buy -> execute_batch | FAILED (PoolNotCreatedAtomically) | `5mHgYN6rjSZJMZ2xYYSQsabSNzcCriM5H7GEAQKTXTWYyXpccwjEF1nXT32WtRnuzWCJb4oEAGTfP6bQeT4PgYna` |
| ATTACK init uncommitted pool -> execute_batch against it | FAILED (ConstraintAddress) | `3aXMrfU56RiSJJoDn6qgZujs1CFU1UzUHTAvdZ2Zk5wUYjAvkAkmrbyhjaDF9gzbtSyAbV4Bt5WY3941y37nRDob` |
| settlement tx (slippage batch) init + execute_batch | FAILED (ExceededSlippage) | `4N9RPJN1DQNU1rtBGV7m2vyo8zxoRm4HwrEpiuNfyZ42GRtVJwK7YAv5Zo9k8eCtam3oAzzEE1Saa7SobkG7y5Kh` |
| SETTLEMENT init_pool + execute_batch | OK | `4E5mGR7EW3PRGZuv5NJQdxUMGDpNrXXuB9GTRTanJe19KfWMfUEyadz46fByRfzke9ryyC6LUQg9LFv8sbgsqJ5y` |
| ATTACK replay execute_batch alone | FAILED (account already in use) | `46BsE9Ckaez1TVMwLRWRLHyikhXAizAsZKtbmZr6LtrAd6xByZwTjvzVAVzEc6Z7h4CfvZPCDjmsQuRpfE7g9zi4` |
| ATTACK replay full settlement tx (new blockhash) | FAILED (account already in use) | `5k5SBzhKZ8g2uSj7vytmAmv7ULpMgPP2bj2kz5Wh59XodQ3hAQ9qDryVR1m5gnCRw28Gk77cBuRNukFpJ3NAwpG` |
| ATTACK creator SPL-transfers out of PDA base vault | FAILED (owner does not match) | `72aEXjqydBxsXwCEBsyRxVikUiUfyRefwTdP8oabHCo1Hmcoj5fmdzFbxLgHhhYLaHTx19pPpBDPF8NvT2236iG` |
| ATTACK eve claims alice's share | FAILED (ConstraintSeeds) | `3mHjexwPdPy4GUxGU1n1GuAdiGsprTCiTyFkHRieFkC9EEDGYAsbJnSPdvjMQmGLWTmHAdFZ46wcwd8cv5evC4c4` |
| ATTACK eve claims without contribution | FAILED (AccountNotInitialized) | `64XaeHyvgUxGYj9ubpxUdRRV6zPeeq6HwTqmteYj1dro67fLyUrKGQLbD1b52LUc8ZwQ3F5YhkgS53weCfS1Rm36` |
| ATTACK burn_dust before all claims | FAILED (ClaimsOutstanding) | `4EsnJXzSHxBajoh3qAxeMCdUv11cyK7NzCitDWoUdFzNqme3WLrbKXh9rXbKSEENmw1hGHym3FZ5Znt228jjZSVC` |
| claim carol | OK | `zN3s5yuuuJd1fTLVFLrt5eZCz19DyNqXii9bWv4SsC8mCuyEPksTTZFFEgY1f4x3v68Ni8mQZbmPGRCaM8EfKXS` |
| claim alice | OK | `3peNJvfowb1fjctbRHyTRTXDas3a74jWwM4bQppiNMg8sthdTNEhYX8m9xvgV5sEV2iD2nZk5JbtSTHcrZB4qctW` |
| claim bob | OK | `5M173WMtxrVjJygxxDzGq8FbCtvtLH3ayoUXWc8rp2XYqjdZ1sztcZdQjcTR3yaEt9baSw5cSBjRAC9mt4JGeLbP` |
| ATTACK alice double-claims | FAILED (AlreadyClaimed) | `5pd1sWQTjLa6h5bieusvwAVnrMtT3e5G2ke5ojthKwiiCCoiTv95cfdGV2gjtSXUAjfGMoi3wYukWDeR4VMtTSw7` |
| burn_dust (permissionless, after all claims) | OK | `2ghzGYQhwTFpvB5Jj6mK1DzacushbvYCKGhAq37WZEC9bw5JPY9Rp4L77naXVooJm77Detk6pecQ59WNWDA29Mff` |
| ATTACK execute_batch after expiry | FAILED (NotInSettlementWindow) | `4YZuYCCRhY37XnBrQVXpFBKzbWEfjV26pGir7ExNBrQsQYbBJenD376PJTUFNspbEaJQtZxhQa34yw99KjWiXJSX` |
| cancel_expired by eve (permissionless) | OK | `2f3V1NAj7NGMLo6QKXWAHwkKjDasbQRvusUrim41TRj7UKwQB58SQ8HcodUqBiptnxwMKVX7xRfySFswXNMrukP9` |
| ATTACK eve refunds alice's deposit to eve | FAILED (ConstraintSeeds) | `3pdd9KM8JYB2RqA4GhTmgwG3myZwqchaMLK6kh5MuTEjzkjRZ2rGnjYhJVnwFdPx1Ad3Bz73A4mFpyjKDjZrYcti` |
| ATTACK alice refunds into eve's token account | FAILED (ConstraintTokenOwner) | `4C55wvyJDCHFPPqNt1xh8XyL9BX68CLswBxhDbwWEoAcqxAe4S4vifMRJC9jTrnqan8eaAo7KyFKtva3v6xaP4zG` |
| refund bob | OK | `3V1xD43owXi8cBTAMinvT7Nk6wsvT2psvFtonEgCy3bdEotp4paWWYe2UfDkCxf6DTSF7JmcNLTnXvHotLacFdMi` |
| refund alice | OK | `5CoJV8bjRwMaKybB1AxT57EXanXzSafjKLowq4XpC7tb9FCcrayr6rVc1gQaHh3MmmsoabsNqJtKFqwimbyD6mfr` |
| refund carol | OK | `3VBNmUujPv7uEKrrpwBCX9P34zSsNFcFENJhMHJJ8PUYk3nPtxKAttzKLnyPju9as5pPFyLQHqK4G8LFrmY9PVQK` |
| ATTACK bob double-refund | FAILED (AlreadyRefunded) | `4BeM6hQCBKba5f2ZwetTPq59Wwc7bJwArQKN5KuXYWuRqjL3263i2ftW6C7ZCwagUSRjcXMXGFJhemxofqLppAf3` |

## How the guarantees are enforced

- **Atomic and fresh pool:** `execute_batch` must be a top-level instruction (`get_stack_height()==1`, and the current instruction's program is EqualStart). The instruction *immediately before it* must be DBC `initialize_virtual_pool_with_spl_token`, with accounts[0,3,4,5] equal to the committed config, base mint, wSOL and pool. DBC `init`s the pool, so that instruction fails if the pool already exists. Defence in depth: the pool account's owner, discriminator, config, base mint and vaults must match, and `has_swap==0 && quote_reserve==0`.
- **Committed config:** `initialize_batch` requires the DBC config to be DBC-owned, have quote mint = wSOL, SPL token type, base fee mode ≠ RateLimiter, `enable_first_swap_with_min_fee == 0`, and `max_pool_quote_in < migration_quote_threshold`. The pool address is derived on-chain from config + base mint and stored.
- **Output verification:** the program compares vault balances before and after. The quote spent must equal the batch total exactly (no partial fill), and the base received must be ≥ `min_base_out` (DBC also enforces `amount_1`).
- **No privileged withdrawal:** funds only move via participant-signed `withdraw` (before close), `claim`, `refund`, the single PDA-signed swap, and `burn_dust`. The creator has no authority after initialization.
- **Deadlines** come only from the `Clock` sysvar. Arithmetic uses checked ops, and claims use u128 intermediates.

Deviations from `CHAIN_FEASIBILITY.md`, all deliberate:
- Batch seeds are `[b"batch", creator, launch_id]`, not `[b"batch", launch_id]`, so nobody can squat another creator's launch id.
- The base vault is a PDA `init`ed inside `execute_batch`, because the base mint doesn't exist until ix1.
- There is no separate `min_raise` cancel path; an under-raised batch expires and refunds.

## Remaining security concerns (not solved by this prototype)

1. **Creator liveness/griefing.** The settlement needs the creator's signature and the base-mint keypair. A creator can refuse to settle, or create the committed pool in a separate transaction to make settlement impossible. Funds are never lost: the batch expires and anyone can trigger refunds. But snipers would then trade a pool the participants expected to open first.
2. **First buyer pays the starting fee.** The batch is the first trade, so with a fee scheduler (anti-sniper decaying fee) it pays the highest fee. The config's fees are visible and committed, but `initialize_batch` does not cap the fee level. `min_base_out` is the only economic guard, and it is an absolute amount fixed at init, not scaled to the final raise.
3. **Pinned DBC byte offsets.** EqualStart reads `VirtualPool` and `PoolConfig` fields at offsets from IDL 0.2.1. DBC is upgradeable by Meteora: a layout change could make these checks misread. Discriminator and owner checks fail closed, but field moves inside the same discriminator would not. Re-verify on every DBC upgrade.
4. **Trust in DBC with the PDA signature.** While the batch PDA signs `swap2`, DBC could move any token account that PDA controls. The before/after deltas bound this: the quote vault loses exactly the total, and the base vault is freshly created. Still, a malicious DBC upgrade is outside this design's control.
5. **EqualStart upgrade authority.** Unless the program is deployed immutable, or the upgrade authority is locked with a disclosed process, the escrow is not trustless. Not audited.
6. **Rent and residuals.** Contribution, vault and batch accounts are never closed, so rent is not reclaimed. wSOL donated directly to a quote vault is stranded. Participants must unwrap wSOL themselves.
7. **Sybil.** Per-wallet caps are trivially bypassed with more wallets.
8. **Same-transaction buys after settlement.** The batch is guaranteed the *first* buy. The creator, who builds the settlement transaction, can append their own buy right after `execute_batch` in the same transaction (second-buyer advantage).
9. **Not tested on public devnet.** The faucet was rate-limited and `keys/deployer.json` has 0 SOL. Localnet uses the identical DBC bytecode, but a public run would add independently checkable signatures.

## Reproduce

```bash
# toolchain: Agave 4.3.0, Rust stable, anchor-cli 1.2.1 (cargo install anchor-cli --version 1.2.1 --locked), Node 22
cd onchain && npm install && anchor build
scripts/localnet.sh &                       # DBC_SO=../fixtures/dbc_devnet.so to use the devnet build
EVIDENCE_NAME=run.json NODE_OPTIONS=--no-experimental-strip-types \
  npx ts-mocha -p ./tsconfig.json -t 1000000 tests/equalstart.ts
```

Files: `onchain/programs/equalstart/src/lib.rs` (program), `onchain/tests/equalstart.ts` (onchain tests), `evidence/localnet-dbc-{mainnet,devnet}-binary.{json,txt}` (signatures, full logs, CU, balances).
