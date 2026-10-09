# EqualStart: experimental feasibility bundle

**Updated:** October 8, 2026. **Onchain tests:** PASS on localnet against the real Meteora DBC binaries (Anchor program in `onchain/`, results in `ONCHAIN_RESULTS.md`). Public devnet run not yet performed.

This bundle contains:
- `settlement.mjs`: minimal fee-free accounting model using raw integer token units (`BigInt`), independent claims/refunds, and explicit atomicity/slippage preconditions.
- `settlement.test.mjs`: twelve tests, including 1000 deterministic randomized rounding trials.
- `CHAIN_FEASIBILITY.md`: verified DBC documentation and the proposed actual Anchor integration, plus strict pass/fail gates.
- `CLAUDE_TASK.md`: handoff for networked Claude Code environment to test real onchain CPIs.

Run with Node 20+: `npm test`.

**Do not deploy this JS model or trust it with funds.** It is neither an onchain escrow nor a complete security model. CPI compatibility, signer flags, current program data, first-swap context, transaction limits and actual onchain devnet behavior remain unverified.

The prototype assumes a standard SPL Token WSOL quote mint and normal DBC base SPL Token, same one-batch effective blended price, no fee-on-transfer token, no oversubscription, no partial fill, and zero new buys interleaved before the batched purchase.
