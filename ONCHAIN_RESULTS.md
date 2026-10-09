# EqualStart: onchain results (updated 2026-10-08)

**Verdict: permissionless atomic settlement is feasible and PASSES on public devnet against Meteora's live DBC program (10/10, 2026-10-09; explorer links in [`VERIFICATION.md`](VERIFICATION.md)), and on localnet against the mainnet and devnet DBC binaries.**

Devnet settlement: [`3mPebdq9…tkN7t`](https://explorer.solana.com/tx/3mPebdq9aesrtS28sEaRJqXjMwM54BkXbotfGugknUVVQUwUdo46s2iXtubUWojGGy5VRaLnJgb2wccHSbatkN7t?cluster=devnet), 218,120 CU, signed only by a wallet with no role in the launch. Deployed program bytes match the local build (sha256 `75df8dc1…01d3`).

## What changed since the first proof (commit 204524f)

The first proof needed the creator: the settlement transaction was an SDK-built DBC pool init signed by the creator and a base-mint keypair, followed by `execute_batch`. A creator who walked away, or created the pool separately, blocked settlement.

Now settlement is one permissionless EqualStart instruction, `settle`. It does four things via CPI:

```
EqualStart Settle                                       invoke [1]   (signed only by the settler, any wallet)
  DBC InitializeVirtualPoolWithSplToken                 invoke [2]   creator = batch PDA, base_mint = batch PDA (both invoke_signed)
    Metaplex CreateMetadataAccountV3 / System / Token   invoke [3..4]
  Associated Token: create batch base vault             invoke [2]
  DBC Swap2 ExactIn (payer = batch PDA)                 invoke [2]   amount_in = whole batch, min_out from actual total
  DBC TransferPoolCreator -> committed creator          invoke [2]
  "EqualStart settled: quote_spent=… base_received=… min_base_out=… opening_fee=…"
```

**Why this is safe (DBC source @ f552f20, `ix_initialize_virtual_pool_with_spl_token.rs`):**
- DBC requires `base_mint` to be an `init, signer` account, and `creator` to be a `Signer`.
- In EqualStart, the base mint is the PDA `["mint", batch]` and the creator is the batch PDA. Only EqualStart can produce either signature, and only inside `settle`.
- So the committed pool cannot exist before `settle` runs, and no other buy can come before the batch's.
- This replaces the instruction-sysvar "previous instruction" check entirely.
- DBC has no stack-height check on pool init. The only CPI restrictions it has are the rate-limiter fee mode and first-swap-min-fee, and both are rejected at `initialize_batch`.
- CPI depth peaks at 4 (EqualStart → DBC → Metaplex → System), within the limit.

## Pinned versions

| Component | Version |
|---|---|
| `@meteora-ag/dynamic-bonding-curve-sdk` | 1.5.13 (exact) |
| DBC IDL (bundled in SDK) | 0.2.1, saved to `idl/dynamic_bonding_curve.json` |
| DBC source cross-checked | MeteoraAg/dynamic-bonding-curve @ f552f20 |
| DBC mainnet binary | sha256 `4c26a8a5…f23b` (`fixtures/dbc_mainnet.so`) |
| DBC devnet binary | sha256 `5edf76d9…8ad3` (`fixtures/dbc_devnet.so`); re-dumped from devnet today, still identical |
| Anchor (lang/spl/cli/TS client) | 1.2.1 |
| Agave / solana-test-validator | 4.3.0 |
| EqualStart program id | `6m6BShPDaXgQG71YSKZ2rgM9hfLVYhm3QSv3Z2TnPX1j` |

DBC instructions EqualStart calls:
- `initialize_virtual_pool_with_spl_token`: 16 accounts, args `{name, symbol, uri}`.
- `swap2`: 15 accounts, args `SwapParameters2 { amount_0: u64, amount_1: u64, swap_mode: u8 }`, with 0 = ExactIn.
- `transfer_pool_creator`: 6 accounts, no args.

All discriminators and account orders come from IDL 0.2.1 and are hard-coded in `lib.rs` (`mod dbc`).

## Settlement (mainnet DBC binary)

Signature: `4h2pcxNw5FETH2JT2EVjvx4uueGuK417JKFWMv2AQP6WqM64Cnyyj6UPaEmb293vMjzEpGLJkuvzioBtoEnCnVzW`. Settled by `eve`, an unrelated wallet. The creator signed nothing after `initialize_batch`.

**Simulation:** done first.

| | CU | Size | Account keys |
|---|---|---|---|
| Mainnet binary | 204,171 | 814 of 1,232 bytes | 21 (no ALT needed) |
| Devnet binary | 227,186 | 814 bytes | 21 |

Devnet-binary settlement signature: `3WkJBN6Ft71Lqc4VjxgDprjFRo22uD9yVAcuep7F5RHft8nVoWbD3wM57nekW3Fnz7smqsTHRrjwgVpyri6BSoPr`.

**Batch and pool:**
- quote spent: 600,000,000 of 600,000,000. The quote vault went to 0.
- base received: 19,453,340,776,307.
- `min_base_out` = floor(600,000,000 × 30e12 / 1e9) = 18,000,000,000,000. It is computed on-chain from the actual final total.
- Opening fee measured from the pool's fee counters: 6,000,000 lamports, exactly 1%. The committed ceiling was 100 bps.
- Pool state: `has_swap=1`; `creator` = the committed creator (transferred via CPI); config and base mint as committed.

**Lamports:**
- Settler net: +28,458,040 lamports. That is the 0.05 SOL bounty minus the rent for mint, pool, vaults and metadata.
- Creator lamport change during settlement: 0.

**Pool history:** the only successful transactions that touched the pool address are the settlement and the attacker's lamport donation.

**Claims (1:2:3):** each claim is an exact floor.

| Participant | Raw units |
|---|---|
| Alice | 3,242,223,462,717 |
| Bob | 6,484,446,925,435 |
| Carol | 9,726,670,388,153 |

2 units of dust were burned permissionlessly after the last claim.

**Refunds:** both batches recovered without the creator.
- Abandoned batch (nobody settled): cancelled by eve after expiry. Alice got back 0.05, Bob 0.10 and Carol 0.15 wSOL, exactly 1:1. The 0.05 SOL bounty went back to the creator.
- Underfunded batch (min raise not met): Bob got back his 0.10.

## How the guarantees are enforced

- **Permissionless, atomic, fresh pool:** described in the section above. In addition, after DBC init, the program checks the pool's owner, discriminator, config, base mint and vault addresses, and requires `has_swap==0 && quote_reserve==0`.
- **Settlement inputs:** the settler supplies only accounts, and each is pinned:
  - `batch.creator`, `batch.pool`, `batch.base_mint`, `batch.base_vault` and the config are fixed by address.
  - DBC re-derives its own PDAs, and Metaplex re-derives the metadata PDA.
  - Nothing the settler passes changes the price, the amount or who receives the tokens.
- **Opening fee vs. committed ceiling (`max_opening_fee_bps`):** checked twice.
  1. Before deposits, `initialize_batch` requires `cliff_fee_numerator × 10_000 ≤ max_opening_fee_bps × 1e9`. Every DBC base-fee schedule starts at the cliff fee, and the pool activates in the settling instruction.
  2. After the swap, `settle` reads the pool's `total_trading_*_fee + total_protocol_*_fee` and requires `fee × 10_000 ≤ bps × gross`. These counters are all zero before the swap because the pool is new, and this check covers the dynamic fee too. Arithmetic is u128.
- **Minimum output from the actual total:** the creator commits `min_base_per_sol` (a minimum average price).
  - `settle` computes `min_out = max(1, floor(total_quote × min_base_per_sol / 1e9))` in checked u128.
  - It passes `min_out` to DBC and re-checks it against the base vault's actual balance change.
  - `initialize_batch` rejects terms where this overflows at `max_pool_quote_in`.
- **Other config rules:** the DBC config must be DBC-owned, use wSOL as quote, use SPL token type, not use the RateLimiter fee mode, have `enable_first_swap_with_min_fee == 0`, use a collect-fee mode of 0 or 1, and have `max_pool_quote_in < migration_quote_threshold`.
- **No privileged withdrawal:** funds move only via:
  - participant-signed `withdraw` (before close), `claim` and `refund`
  - the PDA-signed swap
  - permissionless `burn_dust`
  - bounty lamports, which go only to the settler or back to the committed creator.
- **Creator abandonment:** the creator's only action is `initialize_batch`.
  - From then on anyone can settle (between close and expiry) or cancel (after expiry).
  - Refunds are participant-signed and pay only to the participant's own wSOL account.
- **Deadlines** come only from `Clock`. All arithmetic is checked.

**Deliberate deviations from `CHAIN_FEASIBILITY.md`:**
- The base mint is a batch PDA, not a creator-chosen keypair, so there are no vanity mints.
- The batch PDA is the DBC creator inside `settle`. The role is handed to the committed creator in the same instruction.
- Batch seeds include the creator.
- The base vault is the batch PDA's ATA, created in `settle`.

## All transactions (mainnet DBC binary run, `evidence/localnet-v2-dbc-mainnet-binary.json`)

Every `ATTACK` was sent with `skipPreflight` so it landed on-chain as a failed transaction, and the test asserted the specific error. The `GRIEF` donation succeeds on purpose: settlement must still work after it, and it does.

| Step | Result | Signature |
|---|---|---|
| dbc.create_config good (flat 1%) (SDK) | OK | `5kfFzY29oXzUonijxiU5dxQCxShPguXNjgqmfDpBjom5HcFkMdWQExhdzD3eDnSDV8CHbB1QZSUGRhhkGtT5ULZd` |
| dbc.create_config high-fee (5% -> 1%) (SDK) | OK | `xjcAUWvkSc913SyNzeAQ2C1v1UyE3rJCXGdKSZVzf4rqzda88VYjJVUmPf7gjB7CR4V6v3ADJ5dNKHMhis97iUy` |
| dbc.create_config first-swap-min-fee (SDK) | OK | `5zA82pQJ7wZrriCDyPWBZ6iqNdFGdz7rP2PRhVKwZXHhkZCYiQGXM6WBFBvT2h5U3eo4Phj1oGxh4C6f4Ly3aGiS` |
| initialize_batch main | OK | `5o1oq8ysqEinx2t7yp1atVVWNtM1fN6iigLULjWLM5DzhZTu9LqmsNn5CxFNLMC6erX6QFU1J9NGMw3Ctb9noany` |
| initialize_batch abandoned | OK | `4H2XnLmY1BtJhGL3mhHGd3djRuKRKg2SsS88Q8R4MtC5R98rsHRp6bBh3zGsUfugFAXtEmixSkrLWYmQpQkrktc3` |
| initialize_batch slippage (min 1e18 base per SOL) | OK | `57yNtLPkCJB1GAvTARfMDjTsTnNkUSrqUt64iJSwrhPYgvYwQGq36voUYcGg7ZS5nRtYZVjnsAaUDH61GtLSBe7z` |
| initialize_batch underfunded (min raise 0.5 SOL) | OK | `fQQLUZLHR22aZ1mUtBoAnYZ5518SqTyXtD6Kdk1gbq3X8L1H58yyfuEN1xeYFDcgLLzX4J5cMU6R67Bdnn475zJ` |
| ATTACK re-initialize main batch with new terms | FAILED (already in use) | `5AekMT2NEeNwUuDib51jtZXJnAhtDH164ErBZVMrrinWEFyiYXtmdKukjRCdc4nPppNpY5bhDZFfz7EfLWpCyUCh` |
| ATTACK initialize_batch with non-DBC config | FAILED (InvalidDbcConfig) | `5FEvpKPMULjbTJb1A42KKXQjyycFyncfWLLSsgUeVSMBSxqpiAhfkFFj13LPPkNzfa2iL9CtPSU44YmnXG7eiVJE` |
| ATTACK initialize_batch with first-swap-min-fee config | FAILED (InvalidDbcConfig) | `5JRURzQ3LFTp4drxc4gGXrbjPSvf6NynqN9Vu3mvLcT7wukU1JTYK9aQmRN6ZbbAVy35A59apcpTdK6dybMcWx83` |
| ATTACK initialize_batch: config opening fee 5% > committed 1% | FAILED (OpeningFeeTooHigh) | `5ZPip3EatmtP1SrgLq2evBZFzHa2diarqXF9CcRw2PwyWqck7HwAo6AR81gxjgkBLX4RNyDGz3VitFXzsJiLopvr` |
| ATTACK initialize_batch with max_pool_quote_in >= DBC migration threshold | FAILED (BadTerms) | `5boUZF4JF3GJBFYi5meyDPfBTmsBCgHu4V6K48TatEvA1UfM4MEYC1X6z6jcxG52eGH9EWxHND25GpjdPNpQFcpr` |
| ATTACK initialize_batch: min_base_per_sol overflows u64 at max raise | FAILED (Overflow) | `4fA5kjfYU26QCvSDowtuqevQRdZ2ayra7R4VGormQm4zf27pHZebCp4aTNURBLovapukipMUsePj7sYgjv8xANey` |
| ATTACK initialize_batch with expiry before close | FAILED (BadDeadlines) | `47kzmNkd9MWyjrM47rCCfPPvmTg4hEbAURDVyMucqYecRxpv5bdttgwBqyQfC6FeK4PUA8JDL8aNJfnU2aRt46Dw` |
| wrap 0.7 SOL | OK | `49DGvwHoGkhvJg3jdcWQdXRsWH9DSN5zmWmWzx5G8Xo2Vf7zNA2Mh1gFUkGJTJ8k6HmfE8titab7qoKiA24D6Yst` |
| wrap 0.7 SOL | OK | `5VjryGtzoLtBimTKM1itTmMvMfp2dbChLCeQPrawmVLNUAZBBwA9RtvamEeHxb1rrVvxQuF3JyMAKeBi7RrAd8n8` |
| wrap 0.7 SOL | OK | `4WV5dWbs3feZozH3i3e7LUPHszP9b33kE3v4FkPgcxP81KdF7epqZW5CqZseAJPEtgAhcWd8B48vVfwpYa7L6aTD` |
| wrap eve 0.01 SOL | OK | `xj5YevimNF29oSKfb6xHHjDo5bpYu4pVwgwJxH445UEo7Wy9q1UmRwU9nWRjqQC3S7TAVzNzWi8iMXhGjmSvuZe` |
| deposit alice 0.15 (main) | OK | `4xa6dNDGbWGPiR5AAx9NnehxEWscz9UhYwfCg1VC186Lkz2VNBwTFvQk9dTTfg7hYn2zpo7Rz4RyAdNmd6GM4p1Q` |
| withdraw alice 0.05 before close (main) | OK | `2BbXBUPcEwvXXMaZiW2byQ1WXwmPWs7XVLbY8ph8mWYsCd9JHuZGjiPPzx5gMrteb7t7RMUfDuXi9X4sykJHKiEZ` |
| deposit bob 0.2 (main) | OK | `128FHcceZWAHzqutENKWeYxnWAVxZbM32joTBfb562zYmALtPCvoo95D2jufL89mERqZyrYrZ8wyoC5T3Kmnzkda` |
| deposit carol 0.3 (main) | OK | `eQcK65VtMm3Qr7HV9Apeh7jQLrj2GfeFVa5JUqvjvBHUwwAB6fCfhrUZfdJrb4tWNn5CGS2yg1U5UXbaXBmWPG8` |
| deposit alice 0.05 (abandoned) | OK | `21BQJLa7sCGpFvUyxUiywrzYjzkTFAmpQ3gGjUs3sMAQtdFtZAsq8CNEUt1b4TdFF6fEwdG5hYq3LaU4ECyx1uEV` |
| deposit bob 0.1 (abandoned) | OK | `4SAb9MDVwXeY3K9i3jiYykoBmAehR32omyM1KvbqLE3eRHkMJBS5av7B4uJ5PxP3zoHeaX3hV7NKouvT8ZprQdwt` |
| deposit carol 0.15 (abandoned) | OK | `4vFXNy2MTkqfweRAVK5grVbxJNUvy3tqgoFPAucJbtKytr1RR7Criq2Vwi2yufmgdqwrYs4Jiwh2aNugfkqntPiQ` |
| deposit alice 0.1 (slippage) | OK | `3L9ZGmZiAD9Zy8LkMHLoPn9SeLGa93bFci2oAWPz7FbvB2v3zCm6BnLYLWSZNgFvL1siVfdPAopVKGo5LkSETdvr` |
| deposit bob 0.1 (underfunded) | OK | `4M3M4MHEErw754uWco7gcu9Tub7AdN4ZetChvhNJQtP6HKkZ3ccD9TF8giEmmzh9u7wGYKBSauFjPVcQMWqYDoj4` |
| ATTACK refund before cancellation | FAILED (NotCancelled) | `5vsXFjYTdBeEhWEhbKcs9AbCmF2cgniUVRhaPUP3BC2xqijdpRsb5nzNeY46QYXe4HvrVaZ72cELQmgkEKdUzSZq` |
| ATTACK cancel_expired before expiry | FAILED (NotExpired) | `46J8gUCkZ87QQSrozULLQbEKBGTvNJjwWtygoAF6N4ttkjHw9CHmqtvM8DYzEx1aNHXah2V998usteBrx3L911p1` |
| ATTACK carol exceeds per-wallet cap | FAILED (WalletCapExceeded) | `4XRCv4rjmww6U8xhUd23zZ1bjLK25H74FyGW1oKCHh1KJ8wKjHRppeb7nuCVV8uoVSSP2X5oy6Hq87BaiFtAbiLo` |
| ATTACK eve withdraws from alice's contribution | FAILED (ConstraintSeeds) | `5WLi59GbQc18HFWh9jvDBk4FfuGh2keDoazJFhpokJWvtTFVH5uS8ws8rYfoUshKGPX3JjCNqLujseRmmQujHMDR` |
| ATTACK creator SPL-transfers out of PDA quote vault | FAILED (owner does not match) | `5DS72zPSkDtDcuo4jobu92AHsbcxsxFjKh1j7LtJNTXh23S7oecDRcZxMC9uMjfGzvH6RgJuWjkYzzjpi6XRyo8z` |
| ATTACK settle before closes_at | FAILED (NotInSettlementWindow) | `59d7YDgUHWrDjQG8EbCRAvJj9uiUH47km9T4e6sQjKs1cCG1HppyN7Qc1tD9c6hwEtTWPWHh6uh5upEBSYx9GS5h` |
| ATTACK deposit after closes_at | FAILED (DepositClosed) | `5RsJkAEa97MAmSrVXuhDGgXiXsVy5TkcDB9Jb7dHtVe7yJndzjTugZ5qqD6fTbM4hSFGJXFQUHQk5nFqW5qYHTVN` |
| ATTACK eve creates the committed DBC pool directly (front-run) | FAILED (unauthorized signer) | `5Kmtah56s9nooGAdGRBuwbfozL52U7XeBp4cEnzJgrSeTBvj7CEGJvuromhgciy3YokzRkijpAKtojhvmMrGKzMW` |
| GRIEF eve pre-funds mint, pool, vaults and metadata addresses | OK | `3ZPoFkdWbWn78rjc9spDyT8kKgFTePAUtDibfvMD4ThQ2TsJ5AHmJxnfyQTicb9hQV8HeYV3DuzYPTGpYedLYEgW` |
| ATTACK settle naming eve as the creator (steal DBC creator role) | FAILED (ConstraintAddress) | `2Ho6TstTjfhR6ux4L6gDofb1wevVoGR2GLnWJbj9ximjZq7jkfv2EEMd5VZzX6kM1zwF9XxZoy8H7AXZ3tm9a6VP` |
| ATTACK settle routing the buy into eve's token account | FAILED (ConstraintAddress) | `66Vkm2n1RwEX3u9uT9K1AaHoJstUwPg7Rifr9R2rj21MJBvRopwnTpW2kAMYCQNBUdvNeASpQJxC9c8wsrFFeWnX` |
| ATTACK settle underfunded batch (min raise not met) | FAILED (MinRaiseNotMet) | `bimCPBX9v1LPwvSRpd93ChBNevgJmNMvK61MomDLthYaFiA7hj6HAXUPpuGxsCY5JFmiDERt9KU5wqR5TBJY9QA` |
| settle slippage batch | FAILED (ExceededSlippage) | `27tKwK1wKotfukgdChpxQ8jAz8wd6SEwyW9w74KC1fgdfoZud7CjyF66LXN8bsdmcsTJp9LCxjcPHVeD3XVHYWAE` |
| SETTLEMENT settle by eve (permissionless) | OK | `4h2pcxNw5FETH2JT2EVjvx4uueGuK417JKFWMv2AQP6WqM64Cnyyj6UPaEmb293vMjzEpGLJkuvzioBtoEnCnVzW` |
| ATTACK replay settle | FAILED (NotOpen) | `45q5XAPBgovZMYRoCmz6y1Peq57fuTaRwXhzCXpJJZRPYazrjYXSdrLDR8t696FHtSU51RUmpyFHSyGz4QiPYn3e` |
| ATTACK creator SPL-transfers out of PDA base vault | FAILED (owner does not match) | `4u7CnagkKbU7iRBDUsRvb5F5WpDgKmPQVeB9Nm3iSTxeJyhZN2jbtqFjEMwpWGaY8WtXhBSeaULP7ivCu3qrXP8K` |
| ATTACK eve claims alice's share | FAILED (ConstraintSeeds) | `hzCtN6sfGLtt8yzT6c1anPRzEi2QxE8pHY7Zhbv4GGiwdiEzzfv8UYZDaPZiLH6oXJt9KMo2sreqNUFqp2pucjg` |
| ATTACK eve claims without contribution | FAILED (AccountNotInitialized) | `4cpn62T1GCri1gVUgpEB5JHq7mGFmhuU8U8Rra56rW6TtAKLcxe7fGV2S5SCsGKRVZhzqqikCcZM1voxbZyVHT5u` |
| ATTACK burn_dust before all claims | FAILED (ClaimsOutstanding) | `642WY8KLGiu4p3wWvepYocH7AvaFFg79PnrVXm91LsKbXrzhGvFGRPCXjjS4GDLvStr4b8SiRN91jeCnsY8T5aT` |
| claim carol | OK | `qGDjYqEgh8nW6udnUFMGZFZydwNjBE5ASeQZwK3ngLFpnyormdLSQyxVdyKBpRc2Lwqi6P86h8cp2ZWXfpxbjxG` |
| claim alice | OK | `5rFcqKMCJ3B2DjRbz3GsULtwyFJdsigR8oDYszx8zyqqMsbtvaFsrfwM4gS393M1DwF4U8D5v43Gfr5wh123gP1L` |
| claim bob | OK | `51TYZpg7pSqrdjHnKp1mabgkVAasXb5S9ZVjycspNWiLtyLyvAUQuC8JRgte2BrFuv9QK9bKukcXLfkWUsHMCDQh` |
| ATTACK alice double-claims | FAILED (AlreadyClaimed) | `5qnR9VsFc7C4GTjqHic5kC3YEPXABhjbyZFoTumKxB7QtFdxKCWN8CcxUs3eJUm8bbby5GxnqjJ8i7yT6xQtcE9M` |
| burn_dust (permissionless, after all claims) | OK | `3dHXVtDxtGkum69gihTQ7hbgbUKApuSV6HgrR73TVG7Jtqn7V8REaghVbC5mpRyP8ELf6uc6pEt7b8RUWfb94hvf` |
| ATTACK settle after expiry | FAILED (NotInSettlementWindow) | `3spvjsKHSVECmxpoQwbho3GoBD5ztdnmZ6VjsJdHG1dB5mwgdqdKARBJTvF4SE9f1V2D9YNPAP9htZLw9TxKcbpY` |
| ATTACK cancel_expired sending bounty to eve | FAILED (ConstraintAddress) | `ewHxhQ5fX42pnTb1CY1hKPuQi68iuwPe37mAtQpuWN51nkxSHwn8nKX1ptXCXTCLvsmFA9LdiFWTStraxq2bDHW` |
| cancel_expired abandoned by eve (permissionless) | OK | `3HWgxnRALxo57k7dW9RS4Zc4bkw4xPeyqFJrK6YfMEXqW5RBfTy2qgMKAPPkufe23yb5R2G2rYko1rqybJhrRYox` |
| ATTACK cancel_expired twice | FAILED (NotOpen) | `AgbDrzJwvG5HQYvsg8n5pk6QgYnFJB322Hkwk4cFmz5zULTX4K69MfWgXFhXVeXyL3vcbcwY6a7rXrcFo65fgfX` |
| ATTACK eve refunds alice's deposit to eve | FAILED (ConstraintSeeds) | `4oq6zmRwK15bAXTnApwbrSLb3CAuRWh6HhraUmAijLbqZHwudueWfwJCV5FL8UCcni8kXFCKTp9h2M4bRiQzGc83` |
| ATTACK alice refunds into eve's token account | FAILED (ConstraintTokenOwner) | `D6DK1RDifCKuqdrrLo8XJHYnNip9i55czVpY93qaghN8DsR29iS8VAYxFt8wxyvntzpC337Qci7XzUk3TPZYJM4` |
| refund bob | OK | `4wBSr7vT38XSnFGdfqUhvFVbfT8qwADZSUdhtMfkw35yyjN2goARUfz2QYL9rQC8jjkyz6vsVjwcqU6bgp7CVtfr` |
| refund alice | OK | `Rsz8AGeVwFtXSgdRY9oDAxEJQWUgtF1Mu4MnpAP92CDW3ErJf1QeQ8wrBqMB91xnVqNfXPz8RZGZwbv5Jen9N3w` |
| refund carol | OK | `5AJ79seEC21gu3ijBQrjn8j5fc3uKw3TFMrTjoFjJjNLd5KUS8fWKqrk9wjnA7RsuFLvnCCsa7o1JXfBYmGzLK5m` |
| ATTACK bob double-refund | FAILED (AlreadyRefunded) | `3AW4CWDBd36PZnEDtWDBZNwWbXvSzXXmWw5jt8rNwkmU9WcamEsVQJtXRCLVcPvDxXeSLYfo83yk38NTZeZXPo5S` |
| cancel_expired underfunded by eve | OK | `2AWaCiJnMqZkLrYRT4hiw3V4mMWkUcGLAGNHqD13MXLnqoPuPADgZhc5Mmf1729xKVeFGP517LXL6uYq7Fqa5L1r` |
| refund bob (underfunded) | OK | `VtpvK9PnbLk4CMnG8MjmAcj87VgQdNtweyvnXeE6hoNVHWKCDBauWqJEYo6hvVPkCCK16VAQZNKPpPXoH7YiZLW` |

## Adversarial coverage (what each case proves)

| Threat | Test | Result |
|---|---|---|
| Creator abandonment | `main` settled by eve, creator inactive; `abandoned` never settled | settled without creator / refunded 1:1 after expiry, bounty back to creator |
| Front-running the pool | eve calls DBC init directly for the committed mint | `Cross-program invocation with unauthorized signer` (mint is an EqualStart PDA) |
| Address pre-funding (DoS) | eve sends lamports to the mint, pool, both DBC vaults, the batch ATA and the metadata PDA | settlement still succeeds |
| Unauthorized settlement inputs | eve names herself as creator / routes tokens to her ATA | `ConstraintAddress` |
| Premature / late settlement | before `closes_at`, after `expires_at` | `NotInSettlementWindow` |
| Min raise not met | settle underfunded batch | `MinRaiseNotMet`, later refunded |
| Replay | settle twice, cancel twice | `NotOpen` |
| Double claim / refund | | `AlreadyClaimed` / `AlreadyRefunded` |
| Claim/refund someone else's deposit | | `ConstraintSeeds` / `ConstraintTokenOwner` |
| Invalid configs | non-DBC account, first-swap-min-fee config, 5% cliff vs 1% ceiling, cap ≥ migration threshold | `InvalidDbcConfig` / `OpeningFeeTooHigh` / `BadTerms` |
| Bad terms | `min_base_per_sol` overflows at max raise; expiry before close; re-initialization | `Overflow` / `BadDeadlines` / already in use |
| Slippage | output below `min_base_per_sol` floor | DBC `ExceededSlippage`; pool and mint creation roll back, deposits intact |
| Vault theft | creator transfers from either PDA vault | Token program `owner does not match` |

## Verified vs. unverified

**Passed on public devnet** (live Meteora DBC, `evidence/devnet-run.{json,txt}`, `VERIFICATION.md`): all 10 test groups, the same suite as below, including creator abandonment, expiry refunds, commitment checks and 1:2:3 claims.

**Passed on a local ledger:** `solana-test-validator` 4.3.0, running the exact DBC bytecode from mainnet, and separately the bytecode from devnet, plus Metaplex Token Metadata.
- Everything in the two tables above, 10/10 test groups on each binary.
- The offchain accounting tests still pass (`npm test`, 12/12).

**Not verified yet:**
- Configs with `collect_fee_mode = OutputToken`, dynamic fee enabled, or a non-zero `pool_creation_fee`. The code handles them, but no test uses one.
- Fee-scheduler configs at real settlement time. Tests use a flat 1% config for settlement and check the 5% config only at initialize.
- Token-2022 base tokens are rejected by design and not supported.
- Behaviour under a future DBC upgrade.

## Remaining security concerns

1. **Pinned DBC layout.** EqualStart hard-codes DBC discriminators, account orders and `VirtualPool`/`PoolConfig` byte offsets from IDL 0.2.1. Meteora can upgrade DBC. Owner and discriminator checks fail closed, but a field moved inside the same struct would be misread. These must be re-verified on every DBC upgrade, ideally with a CI job that diffs the deployed IDL.
2. **Trust in DBC with the PDA signature.** During the CPIs, the batch PDA signs as DBC's creator and swap payer. The before/after checks bound the damage: the quote vault loses exactly the total, base output is at least the minimum, and the creator role is checked after transfer. A malicious DBC upgrade is still out of EqualStart's control.
3. **EqualStart upgrade authority.** On devnet it will be the throwaway deployer key. Calling this trustless requires an immutable deploy or a disclosed multisig with a timelock. Not audited.
4. **Settlement economics.** The settler pays rent (about 0.0215 SOL) plus any DBC `pool_creation_fee` and is repaid by the creator's bounty.
   - With a zero bounty, or a config whose creation fee exceeds the bounty, settling costs money. Settlement then relies on a participant paying for it; otherwise the batch expires and refunds.
   - The program doesn't require `bounty ≥ pool_creation_fee` yet.
5. **Metadata update authority.** If the DBC config sets `CreatorUpdateAuthority`, the update authority becomes the batch PDA, which has no instruction to use it. The metadata is then effectively frozen. The tests use `Immutable`.
6. **Same-transaction buys after settlement.** Deferred as you asked. Because the settler can be anyone, anyone can append a buy right after `settle`. That is the "normal trading after the opening batch" case and cannot come before the batch buy, so I found no exploit that a scan would prevent.
7. **Rent and residuals.** Batch, contribution and vault accounts are never closed. wSOL donated to a quote vault is stranded.
8. **Sybil.** Per-wallet caps are bypassed with more wallets.

## Reproduce

```bash
# toolchain: Agave 4.3.0, Rust stable, anchor-cli 1.2.1, Node 22
cd onchain && npm install && anchor build
scripts/localnet.sh &                       # DBC_SO=../fixtures/dbc_devnet.so for the devnet build
EVIDENCE_NAME=run.json NODE_OPTIONS=--no-experimental-strip-types \
  npx ts-mocha -p ./tsconfig.json -t 1000000 tests/equalstart.ts

# public devnet (needs ~7 devnet SOL at `solana address -k ../keys/deployer.json`)
scripts/devnet.sh                           # deploys, runs the same suite, writes evidence/devnet-run.{json,txt} with explorer links
```

Earlier proof (creator-signed, two-instruction settlement):
- Commit `204524f`.
- Evidence in `evidence/localnet-dbc-{mainnet,devnet}-binary.*`.
- Settlement `4E5mGR7EW3PRGZuv5NJQdxUMGDpNrXXuB9GTRTanJe19KfWMfUEyadz46fByRfzke9ryyC6LUQg9LFv8sbgsqJ5y`.
