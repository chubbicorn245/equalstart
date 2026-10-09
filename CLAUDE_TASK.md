# Claude Code: next executable task (copy this prompt)

We're building EqualStart for the October 12 Meteora hackathon. The attached `settlement.mjs` is an **offchain reference model, not onchain code**. It passes offline tests. Implement the decisive actual onchain proof now, avoiding UI and feature work.

1. Read `CHAIN_FEASIBILITY.md` and the official Meteora DBC Rust CPI, TypeScript SDK, and IDL references. Pin and report actual SDK version, DBC IDL version and `Swap2` account/signature schema.
2. Make an Anchor batch-escrow program with immutable launch terms, per-participant contribution PDAs, batch PDA-controlled wSOL/base vaults, participant-signed deposits, claimed-once pro-rata claims, and permissionless timeout refunds. Prevent privileged withdrawals. The `Clock` sysvar, not caller time, controls deadlines. Use u128 checked intermediates.
3. Implement `execute_batch` as a CPI into DBC `swap2` exact-in with the batch PDA signing via `invoke_signed`/Anchor `CpiContext::new_with_signer`. No special first-swap minimum-fee configuration. Ensure `pool` is the committed base/quote/config pool and actually freshly created. Verify output using before/after vault balances.
4. Compose ONE transaction of an SDK-built pool initialization followed by EqualStart's `execute_batch`. Do not use an externally signing buyer wallet or separate transactions. Simulate first; if creation+swap exceeds transaction or compute constraints, show exact failure and STOP rather than weaken the guarantee.
5. Test Alice 0.1 wSOL, Bob 0.2, Carol 0.3 deposited on devnet/localnet. Confirm real DBC pool first-buy executed in the atomic transaction, independent 1:2:3 claims, refund scenario, inability to change config/replay/steal. Save transaction signatures/logs and balances.
6. Report PASS or BLOCKED based on actual onchain evidence. Keep real/mainnet funds out of this prototype.

The hardest technical proof is PDA-signed `swap2` CPI on a just-created DBC pool inside the same transaction. Prioritize THAT. If time is limited, return the precise blocker and a reproducible minimal test instead of a polished UI or fabricated successful transaction.
