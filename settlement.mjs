// EqualStart: deterministic, executable OFFCHAIN escrow/accounting model.
// This is not an Anchor program, DBC SDK adapter, or security audit.
const U64_MAX = (1n << 64n) - 1n;
const assertUint = (value, label, positive = false) => {
  if (typeof value !== 'bigint' || value < (positive ? 1n : 0n) || value > U64_MAX) {
    throw new RangeError(`${label} must be a${positive ? ' positive' : ' nonnegative'} u64 BigInt`);
  }
};
const requireCondition = (truth, message) => { if (!truth) throw new Error(message); };

export class Batch {
  constructor({ batchId, config, quoteMint, baseMint, depositCap, closesAt, expiresAt, minRaise = 1n }) {
    assertUint(depositCap, 'depositCap', true);
    assertUint(minRaise, 'minRaise', true);
    requireCondition(typeof batchId === 'string' && batchId.length > 0, 'batchId required');
    requireCondition(typeof config === 'string' && config.length > 0, 'config required');
    requireCondition(quoteMint && baseMint && quoteMint !== baseMint, 'distinct mints required');
    requireCondition(Number.isSafeInteger(closesAt) && Number.isSafeInteger(expiresAt) && closesAt < expiresAt, 'bad deadlines');
    this.terms = Object.freeze({batchId, config, quoteMint, baseMint, depositCap, closesAt, expiresAt, minRaise});
    this.phase = 'OPEN';
    this.deposits = new Map();
    this.claimed = new Set();
    this.refunded = new Set();
    this.totalQuote = 0n;
    this.quoteVault = 0n;
    this.baseVault = 0n;
    this.baseReceived = 0n;
    this.actualQuoteUsed = 0n;
    this.claimedBase = 0n;
  }

  deposit({wallet, amount, at}) {
    requireCondition(this.phase === 'OPEN' && at < this.terms.closesAt, 'deposit closed');
    requireCondition(typeof wallet === 'string' && wallet.length > 0, 'wallet required');
    assertUint(amount, 'amount', true);
    const prior = this.deposits.get(wallet) ?? 0n;
    requireCondition(prior + amount <= this.terms.depositCap, 'wallet cap exceeded (not Sybil resistant)');
    requireCondition(this.totalQuote + amount <= U64_MAX, 'quote overflow');
    this.deposits.set(wallet, prior + amount);
    this.totalQuote += amount;
    this.quoteVault += amount;
  }

  withdrawBeforeClose({wallet, amount, at}) {
    requireCondition(this.phase === 'OPEN' && at < this.terms.closesAt, 'withdraw window closed');
    assertUint(amount, 'amount', true);
    const prior = this.deposits.get(wallet) ?? 0n;
    requireCondition(prior >= amount, 'withdrawal exceeds deposit');
    this.deposits.set(wallet, prior - amount);
    this.totalQuote -= amount;
    this.quoteVault -= amount;
  }

  // Emulates the all-or-nothing transition *one onchain transaction must enforce*.
  // Actual onchain design: top-level DBC initialize followed by this program's
  // execute_batch instruction, performing a DBC CPI with PDA-signed token vaults.
  settle({at, quoteSpent, baseReceived, minBaseOut, poolCreatedInSameTransaction, adapterThrows = false}) {
    requireCondition(this.phase === 'OPEN' && at >= this.terms.closesAt && at < this.terms.expiresAt, 'not in settlement window');
    requireCondition(poolCreatedInSameTransaction === true, 'non-atomic pool creation rejected');
    requireCondition(this.totalQuote >= this.terms.minRaise, 'minimum raise not met');
    assertUint(quoteSpent, 'quoteSpent', true);
    assertUint(baseReceived, 'baseReceived', true);
    assertUint(minBaseOut, 'minBaseOut', true);
    requireCondition(quoteSpent === this.totalQuote, 'MVP requires exact-in consumption: no partial fills');
    requireCondition(quoteSpent <= this.quoteVault && baseReceived >= minBaseOut, 'vault/slippage failure');
    // Pretend this throws from a DBC CPI; state must remain unchanged.
    if (adapterThrows) throw new Error('DBC CPI failed: atomic transaction rolls back');
    this.actualQuoteUsed = quoteSpent;
    this.baseReceived = baseReceived;
    this.quoteVault -= quoteSpent;
    this.baseVault += baseReceived;
    this.phase = 'SETTLED';
  }

  entitled(wallet) {
    requireCondition(this.phase === 'SETTLED', 'batch not settled');
    const amount = this.deposits.get(wallet) ?? 0n;
    requireCondition(amount > 0n, 'wallet did not contribute');
    return this.baseReceived * amount / this.totalQuote;
  }

  claim({wallet, signer}) {
    requireCondition(this.phase === 'SETTLED', 'batch not settled');
    requireCondition(wallet === signer, 'claim must be signed by participant');
    requireCondition(!this.claimed.has(wallet), 'double claim');
    const share = this.entitled(wallet);
    requireCondition(share > 0n, 'dust-only entitlement unsupported');
    this.claimed.add(wallet);
    this.baseVault -= share;
    this.claimedBase += share;
    return share;
  }

  cancel({at}) {
    requireCondition(this.phase === 'OPEN' && at >= this.terms.expiresAt, 'cannot cancel yet');
    this.phase = 'CANCELLED'; // anyone may trigger after timeout
  }

  refund({wallet, signer}) {
    requireCondition(this.phase === 'CANCELLED', 'refunds only after cancellation');
    requireCondition(wallet === signer, 'refund must be signed by participant');
    requireCondition(!this.refunded.has(wallet), 'double refund');
    const amount = this.deposits.get(wallet) ?? 0n;
    requireCondition(amount > 0n, 'nothing to refund');
    this.refunded.add(wallet);
    this.quoteVault -= amount;
    return amount;
  }

  // A refund or claim never goes to an arbitrary operator address.
  overview() { return {
    phase:this.phase, totalQuote:this.totalQuote.toString(),
    quoteVault:this.quoteVault.toString(), baseVault:this.baseVault.toString(),
    baseReceived:this.baseReceived.toString(), claimedBase:this.claimedBase.toString(),
    participants:this.deposits.size,
  }; }
}
