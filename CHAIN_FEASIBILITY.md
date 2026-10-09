# EqualStart: onchain decision gate (2026-10-08)

**Status: offchain accounting prototype passes; onchain Meteora DBC settlement remains UNVERIFIED.**

## Verified against official documentation

1. Meteora DBC uses program ID `dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN` on devnet and mainnet.
2. The latest TypeScript SDK API has `client.creator.createPoolWithFirstBuy` and `client.creator.createPool`, and returns transaction builders. `createPoolWithFirstBuy` packaging alone DOES NOT let an external PDA sign as its buyer.
3. Program-side CPI swaps are documented as possible. Use `swap2` with ExactIn (mode 0), with an explicit minimum amount out. If the standard DBC swap instruction's buyer must sign, EqualStart must perform its own CPI `invoke_signed` with the deposit-authority PDA seeds.
4. The special `enable_first_swap_with_min_fee` path validates instruction context and may reject CPI-only first swaps. Disable it in the initial DBC configuration; do not use deprecated rate-limiter mode or DAMM v1 migration.
5. CPI for pool creation is possible but computationally and account heavy. We should instead create the pool using a top-level SDK-built instruction and call EqualStart's execute_batch instruction immediately after it **in the same transaction**. These are separate instructions in one atomic transaction, NOT separate transactions.
6. Use SPL Token wSOL as quote in a PDA-controlled token vault (not loose native lamports). DBC CPI needs actual token accounts and correctly prepared SPL token accounts.

Official sources:
- https://docs.meteora.ag/developer-guides/dbc/rust-integration/cpi
- https://docs.meteora.ag/developer-guides/dbc/program/instructions
- https://github.com/MeteoraAg/dynamic-bonding-curve-sdk/blob/main/packages/dynamic-bonding-curve/CHANGELOG.md

## Design choice: atomic two-instruction launch

```
pre-existing setup:
  create approved DBC config on devnet
  create an EqualStart batch with immutable DBC config, base mint, vaults, deadlines
  Alice/Bob/Carol send wSOL via signed SPL Token transfers to PDA-owned quote vault

settlement transaction (ONE Solana transaction):
  ix0: compute budget instructions, if needed
  ix1: Meteora DBC initialize_virtual_pool_with_spl_token   [SDK-built]
  ix2: EqualStart execute_batch                          [OUR Anchor program]
         checks pool config + base mint + zero/initial pool reserves + receipt commitments
         verifies DBC program ID and escrow token accounts
         signs with batch PDA via invoke_signed
         CPIs into Meteora DBC swap2 ExactIn of pooled wSOL
         checks actual before/after token account balances
         rejects if minBaseOut not met or if not all quote consumed
         freezes the batch, makes proportional claims available

Solana transaction atomicity: if any ix fails, all ix changes revert.
No competing external purchase can interleave between ix1 and ix2 inside that transaction.
```

**Attention:** Confirm pool activation allows swaps in this transaction and that standard swap2 accepts our PDA authority. Confirm token program interfaces and DBC event authority accounts. Simulate and measure compute units and transaction bytes. If pool initialization plus custom CPI exceeds Solana transaction limits, mark this design blocked; DO NOT silently move purchases to another transaction and retain the fairness claim.

## Anchor program state / instructions

Accounts:
- `Batch` PDA by `[b"batch", launch_id]` with immutable creator, DBC config, base mint, quote mint, quote vault, base vault, closes_at, expires_at, per_wallet_cap, min_raise, max_pool_quote_in, min_base_out, phase, total_quote, base_received, claimed_count, participants_count.
- `Deposit` PDA by `[b"deposit", batch.key(), participant.key()]` with amount, claimed, refunded flags.
- Quote and base SPL token vault ATAs, with authority Batch PDA. Validate exact account owner/mint/program; never trust arbitrary accounts passed into CPI.

Instructions:
1. `initialize_batch`: lock immutable terms; reject zero fees/inconsistent boundaries. All economics visible before deposits.
2. `deposit(amount)`: signed token transfer; enforce wallet cap, time, mint, balance, storage; update per-wallet amount and batch total atomically. Track participant count for dust.
3. `withdraw(amount)`: signed return of own funds before close only.
4. `execute_batch`: one caller, arbitrary payer, triggered after cutoff and before expiry; validates the DBC pool **was just created at the expected address in this same transaction**, and attempts exactly one CPI swap. Never calls external token program with user-supplied authority; record actual balance deltas.
5. `claim`: signed participant, `floor(total_base_received * deposit_amount / total_quote)`, safe u128 intermediate, claimed boolean before transfer, exact destination ATA, no creator withdrawal route.
6. `cancel_expired`: permissionless after expiry if never settled.
7. `refund`: signed participant, one time, only when canceled.
8. `burn_dust`: permissionless only when every participant has claimed; burn residual dust from batch-owned token account. No private/admin sweep.

## Verification checklist for Claude Code

**Onchain blocking test**:
- Pin Meteora SDK version >= 1.5.13, DBC IDL version and Anchor version actually used; print them.
- Inspect generated `Swap2` accounts and exact signer semantics in pinned IDL/Rust code.
- Use devnet RPC or localnet with Meteora program fixtures. A mock DBC adapter cannot satisfy this gate.
- Run a 3-wallet batch with real token vault balances and a genuinely new DBC pool.
- Print *one* settlement transaction signature containing initialize pool + EqualStart execute + DBC swap CPI. Verify both in transaction logs.
- Verify no earlier swap or buy on the pool, correct DBC config, actual base token output.
- Print Alice/Bob/Carol claim tx signatures and check 1:2:3 claimed balances (allow 1 raw unit rounding).
- Prove expired batch refunds without creator consent.
- Prove direct creator/operator vault transfers are impossible; include adversarial account substitution tests.

**STOP if**: pooled purchase cannot use invoke_signed PDA authority, atomic transaction cannot fit compute/account limits, creator can initialize the committed pool separately and bypass settlement, base vault is withdrawable by operator, or refunds need a human administrator.

## Open problems not solved by the offchain model

- Can Meteora's newly initialized pool be swapped within the same transaction with an `invoke_signed` batch PDA?
- Does the DBC `swap2` instruction require extra sysvars or first-swap constraints for chosen config?
- Can all required accounts fit Solana's transaction size/compute budget? Might need address lookup tables (ALTs), though new addresses require pre-existing ALT configuration.
- Does activation type allow swap immediately following pool initialization?
- Do DBC swap fees or partial-fill rules prevent exact full pooled input? MVP rejects partial fill.
- How are token-account close/rent refunds handled, especially in WSOL and when canceled?
- Escrow claims represent proportional token **amounts**, not a guaranteed financial return or anti-whale system. Per-wallet caps are trivially Sybil bypassed.
- An upgradable program's upgrade authority can potentially affect security. Disclose it; don't claim immutable escrow without a real authority-lock process and independent audit.

## Gate decision

**GO:** Account model + deterministic arithmetic are coherent enough to prototype onchain.
**NOT YET GO:** Onchain DBC CPI and atomic creation have not been executed. No mainnet deployment or public custody until a security review.
