// Client for the EqualStart program: PDAs, account reads and instruction
// builders. Used by the UI and by scripts/smoke.ts, so it has no React imports.
import { Program, type Idl } from "@anchor-lang/core";
import BN from "bn.js";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  SystemProgram,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import idl from "./equalstart.idl.json" with { type: "json" };

export const PROGRAM_ID = new PublicKey(idl.address);
export const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
export const DBC_POOL_AUTHORITY = new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
export const DBC_EVENT_AUTHORITY = new PublicKey("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");
export const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
export const SETTLE_COMPUTE_UNITS = 400_000;

export type Phase = "open" | "settled" | "cancelled";

export type Batch = {
  address: PublicKey;
  creator: PublicKey;
  launchId: BN;
  dbcConfig: PublicKey;
  baseMint: PublicKey;
  quoteMint: PublicKey;
  pool: PublicKey;
  quoteVault: PublicKey;
  baseVault: PublicKey;
  closesAt: number;
  expiresAt: number;
  perWalletCap: BN;
  minRaise: BN;
  maxPoolQuoteIn: BN;
  minBasePerSol: BN;
  maxOpeningFeeBps: number;
  settlerBounty: BN;
  tokenName: string;
  tokenSymbol: string;
  tokenUri: string;
  phase: Phase;
  totalQuote: BN;
  quoteSpent: BN;
  baseReceived: BN;
  totalClaimed: BN;
  participantsCount: number;
  claimedCount: number;
};

export type Contribution = { amount: BN; claimed: boolean; refunded: boolean };

/** What a batch allows right now, derived only from its state and the chain clock. */
export type Stage = "deposits" | "settlement" | "expired" | "settled" | "cancelled";

export function stageOf(batch: Batch, now: number): Stage {
  if (batch.phase === "settled") return "settled";
  if (batch.phase === "cancelled") return "cancelled";
  if (now < batch.closesAt) return "deposits";
  if (now < batch.expiresAt) return "settlement";
  return "expired";
}

export function makeProgram(connection: Connection) {
  // Read-only provider: every transaction is signed by the caller's wallet.
  return new Program(idl as Idl, { connection } as any);
}

export type EqualStart = ReturnType<typeof makeProgram>;

// ---------- addresses ----------

export const batchAddress = (creator: PublicKey, launchId: BN) =>
  PublicKey.findProgramAddressSync([Buffer.from("batch"), creator.toBuffer(), launchId.toArrayLike(Buffer, "le", 8)], PROGRAM_ID)[0];
export const quoteVaultAddress = (batch: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("quote_vault"), batch.toBuffer()], PROGRAM_ID)[0];
export const mintAddress = (batch: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("mint"), batch.toBuffer()], PROGRAM_ID)[0];
export const contributionAddress = (batch: PublicKey, participant: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("deposit"), batch.toBuffer(), participant.toBuffer()], PROGRAM_ID)[0];
export const metadataAddress = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)[0];
export const dbcVaultAddress = (mint: PublicKey, pool: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("token_vault"), mint.toBuffer(), pool.toBuffer()], DBC_PROGRAM_ID)[0];
export const wsolAccount = (owner: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, owner);

// ---------- reads ----------

function toBatch(address: PublicKey, a: any): Batch {
  return {
    address,
    creator: a.creator,
    launchId: a.launchId,
    dbcConfig: a.dbcConfig,
    baseMint: a.baseMint,
    quoteMint: a.quoteMint,
    pool: a.pool,
    quoteVault: a.quoteVault,
    baseVault: a.baseVault,
    closesAt: a.closesAt.toNumber(),
    expiresAt: a.expiresAt.toNumber(),
    perWalletCap: a.perWalletCap,
    minRaise: a.minRaise,
    maxPoolQuoteIn: a.maxPoolQuoteIn,
    minBasePerSol: a.minBasePerSol,
    maxOpeningFeeBps: a.maxOpeningFeeBps,
    settlerBounty: a.settlerBounty,
    tokenName: a.tokenName,
    tokenSymbol: a.tokenSymbol,
    tokenUri: a.tokenUri,
    phase: Object.keys(a.phase)[0] as Phase,
    totalQuote: a.totalQuote,
    quoteSpent: a.quoteSpent,
    baseReceived: a.baseReceived,
    totalClaimed: a.totalClaimed,
    participantsCount: a.participantsCount,
    claimedCount: a.claimedCount,
  };
}

export async function fetchBatch(program: EqualStart, address: PublicKey): Promise<Batch | null> {
  const a = await (program.account as any).batch.fetchNullable(address);
  return a ? toBatch(address, a) : null;
}

export async function fetchAllBatches(program: EqualStart): Promise<Batch[]> {
  const all = await (program.account as any).batch.all();
  return all.map((x: any) => toBatch(x.publicKey, x.account)).sort((a: Batch, b: Batch) => b.closesAt - a.closesAt);
}

export async function fetchContribution(program: EqualStart, batch: PublicKey, participant: PublicKey): Promise<Contribution | null> {
  const a = await (program.account as any).contribution.fetchNullable(contributionAddress(batch, participant));
  return a ? { amount: a.amount, claimed: a.claimed, refunded: a.refunded } : null;
}

export type ContributionRow = Contribution & { address: PublicKey; participant: PublicKey };

/** All contribution accounts of one batch (memcmp on the batch field right after the discriminator). */
export async function fetchContributions(program: EqualStart, batch: PublicKey): Promise<ContributionRow[]> {
  const rows = await (program.account as any).contribution.all([{ memcmp: { offset: 8, bytes: batch.toBase58() } }]);
  return rows
    .map((r: any) => ({ address: r.publicKey, participant: r.account.participant, amount: r.account.amount, claimed: r.account.claimed, refunded: r.account.refunded }))
    .filter((r: ContributionRow) => !r.amount.isZero())
    .sort((a: ContributionRow, b: ContributionRow) => b.amount.cmp(a.amount));
}

export type Activity = { signature: string; time: number | null; ok: boolean; instruction: string; signer: string; error?: string };

export type ActivityLabel = { instruction: string; signer: string; error?: string };

/** Label one transaction from its logs (one getTransaction call). */
export async function labelTransaction(connection: Connection, signature: string): Promise<ActivityLabel | null> {
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  if (!tx) return null;
  const logs = tx.meta?.logMessages ?? [];
  const start = logs.findIndex((l) => l === `Program ${PROGRAM_ID.toBase58()} invoke [1]`);
  const instruction = (start >= 0 ? logs[start + 1]?.match(/Instruction: (\w+)/)?.[1] : undefined) ?? "Other";
  const error = tx.meta?.err ? logs.join("\n").match(/Error Code: (\w+)/)?.[1] ?? "failed" : undefined;
  return { instruction, signer: tx.transaction.message.staticAccountKeys[0].toBase58(), ...(error ? { error } : {}) };
}

/**
 * Transactions that touched the batch account. Uses only getSignaturesForAddress (one call):
 * the public devnet RPC throttles getTransaction hard, so labels come from a prebuilt snapshot when available.
 */
export async function fetchActivity(connection: Connection, batch: PublicKey, labels: Record<string, ActivityLabel> = {}, limit = 60): Promise<Activity[]> {
  const sigs = await connection.getSignaturesForAddress(batch, { limit });
  return sigs.map((s) => {
    const l = labels[s.signature];
    return {
      signature: s.signature,
      time: s.blockTime ?? null,
      ok: !s.err,
      instruction: l?.instruction ?? "Unknown",
      signer: l?.signer ?? "",
      error: s.err ? l?.error ?? "failed" : undefined,
    };
  });
}

/** The settlement is the first successful transaction on the pool address (the pool cannot exist before it). */
export async function findSettlementSignature(connection: Connection, pool: PublicKey): Promise<string | null> {
  const sigs = await connection.getSignaturesForAddress(pool, { limit: 1000 });
  const ok = sigs.filter((s) => !s.err);
  // A lamport donation to the pool address can precede settlement; those never invoke EqualStart, so
  // prefer a signature the snapshot labels as Settle, else the oldest successful one.
  return ok.length ? ok[ok.length - 1].signature : null;
}

/** Same rounding as the program: floor(base_received * amount / total_quote). */
export function claimableShare(batch: Batch, contribution: Contribution): BN {
  if (batch.totalQuote.isZero()) return new BN(0);
  return batch.baseReceived.mul(contribution.amount).div(batch.totalQuote);
}

/** Same as the program: max(1, floor(total_quote * min_base_per_sol / 1e9)). */
export function minBaseOut(totalQuote: BN, minBasePerSol: BN): BN {
  const v = totalQuote.mul(minBasePerSol).div(new BN(1_000_000_000));
  return BN.max(v, new BN(1));
}

/** Reads the DBC config fields EqualStart validates, for display before committing. */
export async function readDbcConfig(connection: Connection, config: PublicKey) {
  const info = await connection.getAccountInfo(config);
  if (!info || !info.owner.equals(DBC_PROGRAM_ID) || info.data.length < 408) return null;
  const d = info.data;
  return {
    quoteMint: new PublicKey(d.subarray(8, 40)),
    cliffFeeBps: Number((d.readBigUInt64LE(104) * 10_000n) / 1_000_000_000n),
    baseFeeMode: d[130],
    collectFeeMode: d[232],
    tokenType: d[237],
    migrationQuoteThreshold: new BN(d.readBigUInt64LE(264).toString()),
    firstSwapMinFee: d[365] === 1,
    poolCreationFee: new BN(d.readBigUInt64LE(368).toString()),
  };
}

// ---------- instructions ----------

export type LaunchTerms = {
  launchId: BN;
  closesAt: number;
  expiresAt: number;
  perWalletCap: BN;
  minRaise: BN;
  maxPoolQuoteIn: BN;
  minBasePerSol: BN;
  maxOpeningFeeBps: number;
  settlerBounty: BN;
  tokenName: string;
  tokenSymbol: string;
  tokenUri: string;
};

export async function initializeBatchIxs(program: EqualStart, creator: PublicKey, dbcConfig: PublicKey, t: LaunchTerms) {
  const batch = batchAddress(creator, t.launchId);
  const ix = await program.methods
    .initializeBatch({ ...t, closesAt: new BN(t.closesAt), expiresAt: new BN(t.expiresAt) })
    .accountsStrict({
      creator,
      batch,
      quoteMint: NATIVE_MINT,
      quoteVault: quoteVaultAddress(batch),
      dbcConfig,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  return { batch, ixs: [ix] };
}

/** Wraps `lamports` SOL into the participant's wSOL account and deposits it, in one transaction. */
export async function depositIxs(program: EqualStart, batch: Batch, participant: PublicKey, lamports: BN): Promise<TransactionInstruction[]> {
  const wsol = wsolAccount(participant);
  return [
    createAssociatedTokenAccountIdempotentInstruction(participant, wsol, participant, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: participant, toPubkey: wsol, lamports: BigInt(lamports.toString()) }),
    createSyncNativeInstruction(wsol),
    await program.methods
      .deposit(lamports)
      .accountsStrict({
        participant,
        batch: batch.address,
        contribution: contributionAddress(batch.address, participant),
        participantQuote: wsol,
        quoteVault: batch.quoteVault,
        quoteMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ];
}

/** Withdraws before close and unwraps the wSOL account back to SOL. */
export async function withdrawIxs(program: EqualStart, batch: Batch, participant: PublicKey, lamports: BN): Promise<TransactionInstruction[]> {
  const wsol = wsolAccount(participant);
  return [
    createAssociatedTokenAccountIdempotentInstruction(participant, wsol, participant, NATIVE_MINT),
    await program.methods
      .withdraw(lamports)
      .accountsStrict({
        participant,
        batch: batch.address,
        contribution: contributionAddress(batch.address, participant),
        participantQuote: wsol,
        quoteVault: batch.quoteVault,
        quoteMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
    createCloseAccountInstruction(wsol, participant, participant),
  ];
}

/** Permissionless: anyone may settle between close and expiry and receives the bounty. */
export async function settleIxs(program: EqualStart, batch: Batch, settler: PublicKey): Promise<TransactionInstruction[]> {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: SETTLE_COMPUTE_UNITS }),
    await program.methods
      .settle()
      .accountsStrict({
        settler,
        batch: batch.address,
        creator: batch.creator,
        quoteVault: batch.quoteVault,
        baseVault: batch.baseVault,
        baseMint: batch.baseMint,
        quoteMint: NATIVE_MINT,
        pool: batch.pool,
        dbcConfig: batch.dbcConfig,
        dbcBaseVault: dbcVaultAddress(batch.baseMint, batch.pool),
        dbcQuoteVault: dbcVaultAddress(NATIVE_MINT, batch.pool),
        mintMetadata: metadataAddress(batch.baseMint),
        metadataProgram: METADATA_PROGRAM_ID,
        dbcPoolAuthority: DBC_POOL_AUTHORITY,
        dbcEventAuthority: DBC_EVENT_AUTHORITY,
        dbcProgram: DBC_PROGRAM_ID,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ];
}

export async function claimIxs(program: EqualStart, batch: Batch, participant: PublicKey): Promise<TransactionInstruction[]> {
  return [
    await program.methods
      .claim()
      .accountsStrict({
        participant,
        batch: batch.address,
        contribution: contributionAddress(batch.address, participant),
        baseVault: batch.baseVault,
        baseMint: batch.baseMint,
        participantBase: getAssociatedTokenAddressSync(batch.baseMint, participant),
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .instruction(),
  ];
}

/** Permissionless after expiry; the unused bounty goes back to the creator. */
export async function cancelIxs(program: EqualStart, batch: Batch): Promise<TransactionInstruction[]> {
  return [await program.methods.cancelExpired().accountsStrict({ batch: batch.address, creator: batch.creator }).instruction()];
}

/** Refunds the full deposit to the participant's wSOL account, then unwraps it to SOL. */
export async function refundIxs(program: EqualStart, batch: Batch, participant: PublicKey): Promise<TransactionInstruction[]> {
  const wsol = wsolAccount(participant);
  return [
    createAssociatedTokenAccountIdempotentInstruction(participant, wsol, participant, NATIVE_MINT),
    await program.methods
      .refund()
      .accountsStrict({
        participant,
        batch: batch.address,
        contribution: contributionAddress(batch.address, participant),
        participantQuote: wsol,
        quoteVault: batch.quoteVault,
        quoteMint: NATIVE_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .instruction(),
    createCloseAccountInstruction(wsol, participant, participant),
  ];
}

export const explorerTx = (sig: string, cluster: string) =>
  cluster === "localnet"
    ? `https://explorer.solana.com/tx/${sig}?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:8899")}`
    : `https://explorer.solana.com/tx/${sig}?cluster=${cluster}`;
export const explorerAddress = (addr: PublicKey | string, cluster: string) =>
  cluster === "localnet"
    ? `https://explorer.solana.com/address/${addr.toString()}?cluster=custom&customUrl=${encodeURIComponent("http://127.0.0.1:8899")}`
    : `https://explorer.solana.com/address/${addr.toString()}?cluster=${cluster}`;
