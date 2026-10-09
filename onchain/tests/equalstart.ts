// Onchain tests for EqualStart against the REAL Meteora DBC program binary
// (dumped from mainnet/devnet, loaded into solana-test-validator, or live on
// public devnet). No mocks.
//
// Settlement is a single permissionless EqualStart instruction that creates the
// DBC pool (batch-PDA mint, batch-PDA creator) and makes the batch buy via CPI.
//
// Every adversarial attempt is sent with skipPreflight so it lands onchain as a
// failed transaction; signatures, logs, CU and balances go to ../evidence/.
import * as anchor from "@anchor-lang/core";
import BN from "bn.js";
import { assert } from "chai";
import * as fs from "fs";
import * as path from "path";
import {
  ComputeBudgetProgram,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  ActivationType,
  BaseFeeMode,
  CollectFeeMode,
  DynamicBondingCurveClient,
  MigrationFeeOption,
  MigrationOption,
  TokenAuthorityOption,
  TokenDecimal,
  TokenType,
  buildCurveWithMarketCap,
  deriveDbcPoolAddress,
  deriveDbcTokenVaultAddress,
} from "@meteora-ag/dynamic-bonding-curve-sdk";
const idl = require("../target/idl/equalstart.json");

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const CLUSTER = process.env.CLUSTER ?? "localnet";
const EVIDENCE_DIR = path.resolve(__dirname, "../../evidence");
const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const DBC_POOL_AUTHORITY = new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
const DBC_EVENT_AUTHORITY = new PublicKey("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");
const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");
const SOL = LAMPORTS_PER_SOL;
const BOUNTY = 0.05 * SOL;
// Timing: public clusters need more slack between deadlines than localnet.
const SLACK = Number(process.env.DEADLINE_SLACK ?? (CLUSTER === "localnet" ? 1 : 8));

const connection = new Connection(RPC, "confirmed");
const dbc = new DynamicBondingCurveClient(connection, "confirmed");
const evidence: any = { cluster: CLUSTER, rpc: RPC.replace(/api-key=[^&]+/, "api-key=***"), startedAt: new Date().toISOString(), versions: {}, transactions: [], balances: {} };

// Wallets. On public clusters a funded FUNDER keypair seeds the others.
const kp = () => Keypair.generate();
// On public clusters the role wallets are saved (keys/ is gitignored) so reruns reuse and only top them up.
const WALLETS_FILE = path.resolve(__dirname, `../../keys/${CLUSTER}-test-wallets.json`);
function roleWallets(): Keypair[] {
  if (CLUSTER === "localnet") return Array.from({ length: 6 }, kp);
  if (fs.existsSync(WALLETS_FILE)) return JSON.parse(fs.readFileSync(WALLETS_FILE, "utf8")).map((k: number[]) => Keypair.fromSecretKey(Uint8Array.from(k)));
  const ws = Array.from({ length: 6 }, kp);
  fs.writeFileSync(WALLETS_FILE, JSON.stringify(ws.map((w) => Array.from(w.secretKey))), { mode: 0o600 });
  return ws;
}
const [partner, creator, alice, bob, carol, eve] = roleWallets();
const funder = process.env.FUNDER_KEYPAIR
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.FUNDER_KEYPAIR, "utf8"))))
  : null;
const wallet = new anchor.Wallet(creator);
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
const program = new anchor.Program(idl as anchor.Idl, provider);
const PROGRAM_ID = program.programId;

// ---------- helpers ----------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chainTime = async () => (await connection.getBlockTime(await connection.getSlot("confirmed")))!;
async function waitUntilChainTime(t: number) {
  while ((await chainTime()) <= t) await sleep(1000);
}
const explorer = (sig: string) =>
  CLUSTER === "localnet" ? null : `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER}`;

// Public clusters: small priority fee, rebroadcast until confirmed, fresh blockhash if it expires.
const PRIORITY_IX = CLUSTER === "localnet" ? [] : [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 20_000 })];

async function sendAndConfirm(ixs: TransactionInstruction[], signers: Keypair[]) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
    const msg = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: [...PRIORITY_IX, ...ixs] }).compileToV0Message();
    const tx = new VersionedTransaction(msg);
    tx.sign(signers);
    const raw = tx.serialize();
    const sig = await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });
    for (let i = 1; (await connection.getBlockHeight("confirmed")) <= lastValidBlockHeight; i++) {
      await sleep(400);
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return { sig, bytes: raw.length };
      if (i % 5 === 0) await connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }).catch(() => {});
    }
    console.log(`           (attempt ${attempt + 1} expired, retrying with a new blockhash)`);
  }
  throw new Error("transaction did not confirm after 4 attempts");
}

async function landTx(label: string, ixs: TransactionInstruction[], signers: Keypair[], expectErr?: RegExp) {
  const { sig, bytes } = await sendAndConfirm(ixs, signers);
  let res = null;
  for (let i = 0; i < 20 && !res; i++) {
    res = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!res) await sleep(500);
  }
  const logs = res?.meta?.logMessages ?? [];
  const entry = {
    label,
    signature: sig,
    explorer: explorer(sig),
    slot: res?.slot,
    ok: res?.meta?.err === null,
    err: res?.meta?.err ?? null,
    computeUnits: res?.meta?.computeUnitsConsumed,
    txBytes: bytes,
    logs,
  };
  evidence.transactions.push(entry);
  console.log(`    [${entry.ok ? "OK  " : "FAIL"}] ${label}\n           ${sig}`);
  if (expectErr) {
    assert.isFalse(entry.ok, `${label} unexpectedly succeeded`);
    assert.match(logs.join("\n"), expectErr, `${label} failed for the wrong reason:\n${logs.join("\n")}`);
  } else {
    assert.isTrue(entry.ok, `${label} failed: ${JSON.stringify(entry.err)}\n${logs.join("\n")}`);
  }
  return entry;
}

async function fund(pk: PublicKey, sol: number) {
  if (funder) {
    const have = await connection.getBalance(pk, "confirmed");
    if (have >= sol * SOL) return;
    sol = (sol * SOL - have) / SOL;
    await landTx(`fund ${pk.toBase58().slice(0, 6)} ${sol} SOL`, [SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pk, lamports: Math.round(sol * SOL) })], [funder]);
  } else {
    const sig = await connection.requestAirdrop(pk, sol * SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }
}

const wsolAta = (owner: PublicKey) => getAssociatedTokenAddressSync(NATIVE_MINT, owner);
function wrapIxs(owner: PublicKey, lamports: number) {
  const ata = wsolAta(owner);
  return [
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, NATIVE_MINT),
    SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports }),
    createSyncNativeInstruction(ata),
  ];
}

async function tokenBalance(acct: PublicKey): Promise<bigint> {
  const info = await connection.getTokenAccountBalance(acct, "confirmed").catch(() => null);
  return info ? BigInt(info.value.amount) : 0n;
}
const lamports = async (pk: PublicKey) => BigInt(await connection.getBalance(pk, "confirmed"));

const batchPda = (creatorPk: PublicKey, launchId: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), creatorPk.toBuffer(), new BN(launchId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
const quoteVaultPda = (batch: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("quote_vault"), batch.toBuffer()], PROGRAM_ID)[0];
const mintPda = (batch: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("mint"), batch.toBuffer()], PROGRAM_ID)[0];
const metadataPda = (mint: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("metadata"), METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()], METADATA_PROGRAM_ID)[0];
const contributionPda = (batch: PublicKey, who: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("deposit"), batch.toBuffer(), who.toBuffer()], PROGRAM_ID)[0];

type BatchCtx = { launchId: number; config: PublicKey; batch: PublicKey; baseMint: PublicKey; pool: PublicKey; quoteVault: PublicKey; baseVault: PublicKey };

function newBatchCtx(launchId: number, config: PublicKey): BatchCtx {
  const batch = batchPda(creator.publicKey, launchId);
  const baseMint = mintPda(batch);
  return {
    launchId,
    config,
    batch,
    baseMint,
    pool: deriveDbcPoolAddress(NATIVE_MINT, baseMint, config),
    quoteVault: quoteVaultPda(batch),
    baseVault: getAssociatedTokenAddressSync(baseMint, batch, true),
  };
}

type Terms = { closesAt: number; expiresAt: number; minBasePerSol?: BN; maxPoolQuoteIn?: BN; minRaise?: BN; maxOpeningFeeBps?: number };
async function initializeBatchIx(ctx: BatchCtx, t: Terms) {
  return program.methods
    .initializeBatch({
      launchId: new BN(ctx.launchId),
      closesAt: new BN(t.closesAt),
      expiresAt: new BN(t.expiresAt),
      perWalletCap: new BN(0.5 * SOL),
      minRaise: t.minRaise ?? new BN(0.05 * SOL),
      maxPoolQuoteIn: t.maxPoolQuoteIn ?? new BN(2 * SOL),
      minBasePerSol: t.minBasePerSol ?? new BN(1),
      maxOpeningFeeBps: t.maxOpeningFeeBps ?? 100,
      settlerBounty: new BN(BOUNTY),
      tokenName: "EqualStart Test",
      tokenSymbol: "EQS",
      tokenUri: "https://example.invalid/eqs.json",
    })
    .accountsStrict({
      creator: creator.publicKey,
      batch: ctx.batch,
      quoteMint: NATIVE_MINT,
      quoteVault: ctx.quoteVault,
      dbcConfig: ctx.config,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

const depositIx = (ctx: BatchCtx, who: Keypair, amount: number, contributionOwner = who.publicKey) =>
  program.methods
    .deposit(new BN(amount))
    .accountsStrict({
      participant: who.publicKey,
      batch: ctx.batch,
      contribution: contributionPda(ctx.batch, contributionOwner),
      participantQuote: wsolAta(who.publicKey),
      quoteVault: ctx.quoteVault,
      quoteMint: NATIVE_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

const withdrawIx = (ctx: BatchCtx, who: Keypair, amount: number, contributionOwner = who.publicKey, dest = wsolAta(who.publicKey)) =>
  program.methods
    .withdraw(new BN(amount))
    .accountsStrict({
      participant: who.publicKey,
      batch: ctx.batch,
      contribution: contributionPda(ctx.batch, contributionOwner),
      participantQuote: dest,
      quoteVault: ctx.quoteVault,
      quoteMint: NATIVE_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

function settleIx(ctx: BatchCtx, settler: PublicKey, o: { creator?: PublicKey; baseVault?: PublicKey } = {}) {
  return program.methods
    .settle()
    .accountsStrict({
      settler,
      batch: ctx.batch,
      creator: o.creator ?? creator.publicKey,
      quoteVault: ctx.quoteVault,
      baseVault: o.baseVault ?? ctx.baseVault,
      baseMint: ctx.baseMint,
      quoteMint: NATIVE_MINT,
      pool: ctx.pool,
      dbcConfig: ctx.config,
      dbcBaseVault: deriveDbcTokenVaultAddress(ctx.pool, ctx.baseMint),
      dbcQuoteVault: deriveDbcTokenVaultAddress(ctx.pool, NATIVE_MINT),
      mintMetadata: metadataPda(ctx.baseMint),
      metadataProgram: METADATA_PROGRAM_ID,
      dbcPoolAuthority: DBC_POOL_AUTHORITY,
      dbcEventAuthority: DBC_EVENT_AUTHORITY,
      dbcProgram: DBC_PROGRAM_ID,
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

const claimIx = (ctx: BatchCtx, who: Keypair, contributionOwner = who.publicKey) =>
  program.methods
    .claim()
    .accountsStrict({
      participant: who.publicKey,
      batch: ctx.batch,
      contribution: contributionPda(ctx.batch, contributionOwner),
      baseVault: ctx.baseVault,
      baseMint: ctx.baseMint,
      participantBase: getAssociatedTokenAddressSync(ctx.baseMint, who.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

const cancelIx = (ctx: BatchCtx, creatorAccount = creator.publicKey) =>
  program.methods.cancelExpired().accountsStrict({ batch: ctx.batch, creator: creatorAccount }).instruction();

const refundIx = (ctx: BatchCtx, who: Keypair, contributionOwner = who.publicKey, dest = wsolAta(who.publicKey)) =>
  program.methods
    .refund()
    .accountsStrict({
      participant: who.publicKey,
      batch: ctx.batch,
      contribution: contributionPda(ctx.batch, contributionOwner),
      participantQuote: dest,
      quoteVault: ctx.quoteVault,
      quoteMint: NATIVE_MINT,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .instruction();

const burnDustIx = (ctx: BatchCtx) =>
  program.methods.burnDust().accountsStrict({ batch: ctx.batch, baseVault: ctx.baseVault, baseMint: ctx.baseMint, tokenProgram: TOKEN_PROGRAM_ID }).instruction();

async function readPool(pool: PublicKey) {
  const info = await connection.getAccountInfo(pool, "confirmed");
  if (!info) return null;
  const d = info.data;
  return {
    owner: info.owner.toBase58(),
    config: new PublicKey(d.subarray(72, 104)).toBase58(),
    creator: new PublicKey(d.subarray(104, 136)).toBase58(),
    baseMint: new PublicKey(d.subarray(136, 168)).toBase58(),
    baseReserve: d.readBigUInt64LE(232).toString(),
    quoteReserve: d.readBigUInt64LE(240).toString(),
    totalProtocolQuoteFee: d.readBigUInt64LE(320).toString(),
    totalTradingQuoteFee: d.readBigUInt64LE(336).toString(),
    hasSwap: d[370],
  };
}

const cu = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });

async function createDbcConfig(label: string, configKp: Keypair, fee: { startingFeeBps: number; endingFeeBps: number; numberOfPeriod: number; totalDuration: number; firstSwapMinFee: boolean }) {
  const curve = buildCurveWithMarketCap({
    token: {
      tokenType: TokenType.SPLToken,
      tokenBaseDecimal: TokenDecimal.SIX,
      tokenQuoteDecimal: 9,
      tokenAuthorityOption: TokenAuthorityOption.Immutable,
      totalTokenSupply: 1_000_000_000,
      leftover: 0,
    },
    fee: {
      baseFeeParams: {
        baseFeeMode: BaseFeeMode.FeeSchedulerLinear,
        feeSchedulerParam: { startingFeeBps: fee.startingFeeBps, endingFeeBps: fee.endingFeeBps, numberOfPeriod: fee.numberOfPeriod, totalDuration: fee.totalDuration },
      },
      dynamicFeeEnabled: false,
      collectFeeMode: CollectFeeMode.QuoteToken,
      creatorTradingFeePercentage: 0,
      poolCreationFee: 0,
      enableFirstSwapWithMinFee: fee.firstSwapMinFee,
    },
    migration: {
      migrationOption: MigrationOption.MET_DAMM_V2,
      migrationFeeOption: MigrationFeeOption.FixedBps25,
      migrationFee: { feePercentage: 0, creatorFeePercentage: 0 },
    },
    liquidityDistribution: {
      partnerPermanentLockedLiquidityPercentage: 50,
      partnerLiquidityPercentage: 0,
      creatorPermanentLockedLiquidityPercentage: 50,
      creatorLiquidityPercentage: 0,
    },
    lockedVesting: { totalLockedVestingAmount: 0, numberOfVestingPeriod: 0, cliffUnlockAmount: 0, totalVestingDuration: 0, cliffDurationFromMigrationTime: 0 },
    activationType: ActivationType.Timestamp,
    initialMarketCap: 30,
    migrationMarketCap: 300,
  });
  const tx = await dbc.partner.createConfig({
    config: configKp.publicKey,
    feeClaimer: partner.publicKey,
    leftoverReceiver: partner.publicKey,
    quoteMint: NATIVE_MINT,
    payer: partner.publicKey,
    ...curve,
  });
  await landTx(`dbc.create_config ${label} (SDK)`, tx.instructions, [partner, configKp]);
  const d = (await connection.getAccountInfo(configKp.publicKey))!.data;
  return {
    address: configKp.publicKey.toBase58(),
    cliffFeeNumerator: d.readBigUInt64LE(104).toString(),
    baseFeeMode: d[130],
    collectFeeMode: d[232],
    enableFirstSwapWithMinFee: d[365],
    tokenType: d[237],
    migrationQuoteThreshold: d.readBigUInt64LE(264).toString(),
  };
}

// ---------- tests ----------

describe(`EqualStart x Meteora DBC (${CLUSTER}, real DBC binary, permissionless settlement)`, function () {
  this.timeout(20 * 60 * 1000);

  const goodConfigKp = kp(), highFeeConfigKp = kp(), minFeeConfigKp = kp();
  const config = goodConfigKp.publicKey;
  let main: BatchCtx; // Alice/Bob/Carol 0.1/0.2/0.3, creator abandons, eve settles
  let abandoned: BatchCtx; // nobody settles -> refunds + bounty back to creator
  let slippage: BatchCtx; // atomic rollback when DBC output < minimum from actual total
  let underfunded: BatchCtx; // min raise not met -> settle fails -> refund
  let mainCloses = 0;
  let abandonedExpires = 0;
  // 0.6 SOL at this curve buys ~32.4e12 base raw per SOL; commit to >= 30e12 per SOL.
  const MAIN_MIN_BASE_PER_SOL = new BN("30000000000000");

  after(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    evidence.finishedAt = new Date().toISOString();
    const out = path.join(EVIDENCE_DIR, process.env.EVIDENCE_NAME ?? `${CLUSTER}-run.json`);
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    console.log(`\n    evidence written to ${out}`);
  });

  it("pins versions and verifies the real DBC + EqualStart programs are deployed", async () => {
    const pkgJson = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "../node_modules", name, "package.json"), "utf8"));
    const sdkPkg = pkgJson("@meteora-ag/dynamic-bonding-curve-sdk");
    const dbcIdl = require("../../idl/dynamic_bonding_curve.json");
    const dbcAccount = await connection.getAccountInfo(DBC_PROGRAM_ID);
    const programData = new PublicKey(dbcAccount!.data.subarray(4, 36));
    const pd = await connection.getAccountInfo(programData);
    evidence.versions = {
      dbcSdk: sdkPkg.version,
      dbcIdl: dbcIdl.metadata.version,
      anchorClient: pkgJson("@anchor-lang/core").version,
      solanaCore: (await connection.getVersion())["solana-core"],
      equalstartProgram: PROGRAM_ID.toBase58(),
      dbcProgramDataSlot: pd ? Number(pd.data.readBigUInt64LE(4)) : null,
    };
    console.log("    versions:", JSON.stringify(evidence.versions));
    assert.equal(sdkPkg.version, "1.5.13");
    for (const id of [DBC_PROGRAM_ID, PROGRAM_ID, METADATA_PROGRAM_ID]) {
      const info = await connection.getAccountInfo(id);
      assert.isTrue(info?.executable, `${id.toBase58()} not deployed`);
    }
  });

  it("funds wallets and creates DBC configs (SDK): good, high opening fee, first-swap-min-fee", async () => {
    for (const [w, sol] of [[partner, 0.15], [creator, 0.45], [alice, 0.6], [bob, 0.6], [carol, 0.6], [eve, 0.4]] as [Keypair, number][]) {
      await fund(w.publicKey, CLUSTER === "localnet" ? 10 : sol);
    }
    evidence.wallets = Object.fromEntries(Object.entries({ partner, creator, alice, bob, carol, eve }).map(([k, v]) => [k, v.publicKey.toBase58()]));
    evidence.dbcConfigs = {
      good: await createDbcConfig("good (flat 1%)", goodConfigKp, { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0, firstSwapMinFee: false }),
      highFee: await createDbcConfig("high-fee (5% -> 1%)", highFeeConfigKp, { startingFeeBps: 500, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 100, firstSwapMinFee: false }),
      minFee: await createDbcConfig("first-swap-min-fee", minFeeConfigKp, { startingFeeBps: 500, endingFeeBps: 100, numberOfPeriod: 10, totalDuration: 100, firstSwapMinFee: true }),
    };
    console.log("    configs:", JSON.stringify(evidence.dbcConfigs));
    assert.equal(evidence.dbcConfigs.good.enableFirstSwapWithMinFee, 0);
    assert.equal(evidence.dbcConfigs.minFee.enableFirstSwapWithMinFee, 1);
  });

  it("initializes batches with immutable terms; rejects invalid configs, bad terms and re-initialization", async () => {
    const now = await chainTime();
    mainCloses = now + 25 * SLACK;
    abandonedExpires = now + 45 * SLACK;
    main = newBatchCtx(1, config);
    abandoned = newBatchCtx(2, config);
    slippage = newBatchCtx(3, config);
    underfunded = newBatchCtx(4, config);
    const creatorBefore = await lamports(creator.publicKey);
    await landTx("initialize_batch main", [await initializeBatchIx(main, { closesAt: mainCloses, expiresAt: now + 600 * SLACK, minBasePerSol: MAIN_MIN_BASE_PER_SOL })], [creator]);
    await landTx("initialize_batch abandoned", [await initializeBatchIx(abandoned, { closesAt: now + 20 * SLACK, expiresAt: abandonedExpires })], [creator]);
    await landTx(
      "initialize_batch slippage (min 1e18 base per SOL)",
      [await initializeBatchIx(slippage, { closesAt: mainCloses, expiresAt: now + 600 * SLACK, minBasePerSol: new BN("1000000000000000000") })],
      [creator],
    );
    await landTx(
      "initialize_batch underfunded (min raise 0.5 SOL)",
      [await initializeBatchIx(underfunded, { closesAt: mainCloses, expiresAt: abandonedExpires, minRaise: new BN(0.5 * SOL) })],
      [creator],
    );
    const batchLamports = await lamports(main.batch);
    const b: any = await (program.account as any).batch.fetch(main.batch);
    assert.equal(b.settlerBounty.toString(), String(BOUNTY));
    assert.isTrue(batchLamports >= BigInt(BOUNTY), "bounty escrowed in the batch account");
    assert.equal(b.pool.toBase58(), main.pool.toBase58());
    assert.equal(b.baseMint.toBase58(), main.baseMint.toBase58());
    assert.isNull(await connection.getAccountInfo(main.baseMint), "base mint does not exist before settlement");
    evidence.mainBatch = { batch: main.batch.toBase58(), pool: main.pool.toBase58(), baseMint: main.baseMint.toBase58(), quoteVault: main.quoteVault.toBase58(), baseVault: main.baseVault.toBase58(), batchLamports: batchLamports.toString(), creatorSpentOnInit: (creatorBefore - (await lamports(creator.publicKey))).toString() };

    await landTx(
      "ATTACK re-initialize main batch with new terms",
      [await initializeBatchIx(main, { closesAt: now + 1000, expiresAt: now + 5000 })],
      [creator],
      /already in use/,
    );
    await landTx("ATTACK initialize_batch with non-DBC config", [await initializeBatchIx(newBatchCtx(10, eve.publicKey), { closesAt: now + 100, expiresAt: now + 200 })], [creator], /InvalidDbcConfig/);
    await landTx(
      "ATTACK initialize_batch with first-swap-min-fee config",
      [await initializeBatchIx(newBatchCtx(11, minFeeConfigKp.publicKey), { closesAt: now + 100, expiresAt: now + 200, maxOpeningFeeBps: 1000 })],
      [creator],
      /InvalidDbcConfig/,
    );
    await landTx(
      "ATTACK initialize_batch: config opening fee 5% > committed 1%",
      [await initializeBatchIx(newBatchCtx(12, highFeeConfigKp.publicKey), { closesAt: now + 100, expiresAt: now + 200, maxOpeningFeeBps: 100 })],
      [creator],
      /OpeningFeeTooHigh/,
    );
    await landTx(
      "ATTACK initialize_batch with max_pool_quote_in >= DBC migration threshold",
      [await initializeBatchIx(newBatchCtx(13, config), { closesAt: now + 100, expiresAt: now + 200, maxPoolQuoteIn: new BN("100000000000") })],
      [creator],
      /BadTerms/,
    );
    await landTx(
      "ATTACK initialize_batch: min_base_per_sol overflows u64 at max raise",
      [await initializeBatchIx(newBatchCtx(14, config), { closesAt: now + 100, expiresAt: now + 200, minBasePerSol: new BN("18446744073709551615") })],
      [creator],
      /Overflow/,
    );
    await landTx("ATTACK initialize_batch with expiry before close", [await initializeBatchIx(newBatchCtx(15, config), { closesAt: now + 100, expiresAt: now + 50 })], [creator], /BadDeadlines/);
  });

  it("Alice 0.1, Bob 0.2, Carol 0.3 deposit with their own signatures; caps, theft and premature settlement fail", async () => {
    for (const w of [alice, bob, carol]) await landTx(`wrap 0.5 SOL`, wrapIxs(w.publicKey, 0.5 * SOL), [w]);
    await landTx(`wrap eve 0.01 SOL`, wrapIxs(eve.publicKey, 0.01 * SOL), [eve]);
    await landTx("deposit alice 0.15 (main)", [await depositIx(main, alice, 0.15 * SOL)], [alice]);
    await landTx("withdraw alice 0.05 before close (main)", [await withdrawIx(main, alice, 0.05 * SOL)], [alice]);
    await landTx("deposit bob 0.2 (main)", [await depositIx(main, bob, 0.2 * SOL)], [bob]);
    await landTx("deposit carol 0.3 (main)", [await depositIx(main, carol, 0.3 * SOL)], [carol]);
    await landTx("deposit alice 0.05 (abandoned)", [await depositIx(abandoned, alice, 0.05 * SOL)], [alice]);
    await landTx("deposit bob 0.1 (abandoned)", [await depositIx(abandoned, bob, 0.1 * SOL)], [bob]);
    await landTx("deposit carol 0.15 (abandoned)", [await depositIx(abandoned, carol, 0.15 * SOL)], [carol]);
    await landTx("deposit alice 0.1 (slippage)", [await depositIx(slippage, alice, 0.1 * SOL)], [alice]);
    await landTx("deposit bob 0.1 (underfunded)", [await depositIx(underfunded, bob, 0.1 * SOL)], [bob]);

    await landTx("ATTACK refund before cancellation", [await refundIx(abandoned, alice)], [alice], /NotCancelled/);
    await landTx("ATTACK cancel_expired before expiry", [await cancelIx(abandoned)], [eve], /NotExpired/);
    await landTx("ATTACK carol exceeds per-wallet cap", [await depositIx(main, carol, 0.25 * SOL)], [carol], /WalletCapExceeded/);
    await landTx("ATTACK eve withdraws from alice's contribution", [await withdrawIx(main, eve, 0.1 * SOL, alice.publicKey, wsolAta(alice.publicKey))], [eve], /ConstraintSeeds/);
    await landTx(
      "ATTACK creator SPL-transfers out of PDA quote vault",
      [...wrapIxs(creator.publicKey, 1000), createTransferInstruction(main.quoteVault, wsolAta(creator.publicKey), creator.publicKey, 0.6 * SOL)],
      [creator],
      /owner does not match/,
    );
    await landTx("ATTACK settle before closes_at", [cu(600_000), await settleIx(main, eve.publicKey)], [eve], /NotInSettlementWindow/);
    assert.isNull(await connection.getAccountInfo(main.pool));

    assert.equal(await tokenBalance(main.quoteVault), BigInt(0.6 * SOL));
    const b: any = await (program.account as any).batch.fetch(main.batch);
    assert.equal(b.totalQuote.toString(), String(0.6 * SOL));
    assert.equal(b.participantsCount, 3);
  });

  it("nobody but EqualStart can create the committed pool; griefing and unauthorized settlement inputs fail", async () => {
    await waitUntilChainTime(mainCloses);
    await landTx("ATTACK deposit after closes_at", [await depositIx(main, alice, 0.01 * SOL)], [alice], /DepositClosed/);

    // Front-run: eve calls DBC directly to create the committed pool before settle.
    // The base mint is an EqualStart PDA, so eve can only pass it unsigned.
    const sdkTx = await dbc.creator.createPool({
      name: "Sniped",
      symbol: "SNP",
      uri: "https://example.invalid/snp.json",
      payer: eve.publicKey,
      poolCreator: eve.publicKey,
      config,
      baseMint: main.baseMint,
    });
    const frontRun = sdkTx.instructions.filter((ix) => ix.programId.equals(DBC_PROGRAM_ID));
    assert.equal(frontRun.length, 1);
    frontRun[0].keys = frontRun[0].keys.map((k) => (k.pubkey.equals(main.baseMint) ? { ...k, isSigner: false } : k));
    await landTx("ATTACK eve creates the committed DBC pool directly (front-run)", [cu(400_000), frontRun[0]], [eve], /AccountNotSigner|ConstraintSigner|missing required signature|signer privilege escalated/);
    assert.isNull(await connection.getAccountInfo(main.pool));

    // Griefing: pre-fund every address settle will create. Settlement must still work.
    const grief = [main.baseMint, main.pool, main.baseVault, metadataPda(main.baseMint), deriveDbcTokenVaultAddress(main.pool, main.baseMint), deriveDbcTokenVaultAddress(main.pool, NATIVE_MINT)];
    await landTx("GRIEF eve pre-funds mint, pool, vaults and metadata addresses", grief.map((toPubkey) => SystemProgram.transfer({ fromPubkey: eve.publicKey, toPubkey, lamports: 1_000_000 })), [eve]);

    // Unauthorized inputs to the permissionless settle.
    await landTx("ATTACK settle naming eve as the creator (steal DBC creator role)", [cu(600_000), await settleIx(main, eve.publicKey, { creator: eve.publicKey })], [eve], /ConstraintAddress/);
    await landTx("ATTACK settle routing the buy into eve's token account", [cu(600_000), await settleIx(main, eve.publicKey, { baseVault: getAssociatedTokenAddressSync(main.baseMint, eve.publicKey) })], [eve], /ConstraintAddress/);
    await landTx("ATTACK settle underfunded batch (min raise not met)", [cu(600_000), await settleIx(underfunded, eve.publicKey)], [eve], /MinRaiseNotMet/);
    assert.equal(await tokenBalance(main.quoteVault), BigInt(0.6 * SOL));
  });

  it("SLIPPAGE: settle reverts entirely (pool creation included) when output < minimum from the actual total", async () => {
    await landTx("settle slippage batch", [cu(600_000), await settleIx(slippage, eve.publicKey)], [eve], /ExceededSlippage/);
    assert.isNull(await connection.getAccountInfo(slippage.pool), "pool creation must roll back with the failed swap");
    assert.isNull(await connection.getAccountInfo(slippage.baseMint));
    assert.equal(await tokenBalance(slippage.quoteVault), BigInt(0.1 * SOL));
  });

  it("SETTLEMENT: creator absent; unrelated wallet settles in ONE instruction (DBC init + swap2 + creator handoff via CPI)", async () => {
    const ix = await settleIx(main, eve.publicKey);
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const simMsg = new TransactionMessage({ payerKey: eve.publicKey, recentBlockhash: blockhash, instructions: [cu(1_400_000), ix] }).compileToV0Message();
    const simTx = new VersionedTransaction(simMsg);
    simTx.sign([eve]);
    const sim = await connection.simulateTransaction(simTx, { sigVerify: true });
    evidence.settlementSimulation = { err: sim.value.err, unitsConsumed: sim.value.unitsConsumed, txBytes: simTx.serialize().length, txByteLimit: 1232, accountKeys: simMsg.staticAccountKeys.length, logs: sim.value.logs };
    console.log(`    simulation: err=${JSON.stringify(sim.value.err)} CU=${sim.value.unitsConsumed} bytes=${simTx.serialize().length}/1232 keys=${simMsg.staticAccountKeys.length}`);
    assert.isNull(sim.value.err, (sim.value.logs ?? []).join("\n"));

    const eveBefore = await lamports(eve.publicKey);
    const creatorBefore = await lamports(creator.publicKey);
    const entry = await landTx("SETTLEMENT settle by eve (permissionless)", [cu(Math.ceil(sim.value.unitsConsumed! * 1.2)), ix], [eve]);
    evidence.settlementSignature = entry.signature;
    const logs = entry.logs.join("\n");

    // EqualStart is the only top-level program; DBC init, swap2 and creator transfer are its CPIs.
    assert.match(logs, new RegExp(`Program ${PROGRAM_ID.toBase58()} invoke \\[1\\]\\nProgram log: Instruction: Settle`));
    assert.match(logs, new RegExp(`Program ${DBC_PROGRAM_ID.toBase58()} invoke \\[2\\]\\nProgram log: Instruction: InitializeVirtualPoolWithSplToken`));
    assert.match(logs, new RegExp(`Program ${DBC_PROGRAM_ID.toBase58()} invoke \\[2\\]\\nProgram log: Instruction: Swap2`));
    assert.match(logs, new RegExp(`Program ${DBC_PROGRAM_ID.toBase58()} invoke \\[2\\]\\nProgram log: Instruction: TransferPoolCreator`));
    assert.notMatch(logs, new RegExp(`Program ${DBC_PROGRAM_ID.toBase58()} invoke \\[1\\]`));
    const m = logs.match(/EqualStart settled: quote_spent=(\d+) base_received=(\d+) min_base_out=(\d+) opening_fee=(\d+)/);
    assert.ok(m, "settle log line");
    const [quoteSpent, baseReceived, minBaseOut, openingFee] = m!.slice(1).map(BigInt);
    assert.equal(quoteSpent, BigInt(0.6 * SOL));
    assert.equal(minBaseOut, (BigInt(0.6 * SOL) * BigInt(MAIN_MIN_BASE_PER_SOL.toString())) / 1_000_000_000n, "min out computed from the actual final total");
    assert.isTrue(baseReceived >= minBaseOut);
    assert.equal(openingFee, BigInt(0.6 * SOL) / 100n, "1% opening fee measured from pool counters");

    const pool = await readPool(main.pool);
    const b: any = await (program.account as any).batch.fetch(main.batch);
    const baseVault = await tokenBalance(main.baseVault);
    const eveAfter = await lamports(eve.publicKey);
    evidence.settlement = {
      pool,
      batchBaseVault: baseVault.toString(),
      quoteVaultAfter: (await tokenBalance(main.quoteVault)).toString(),
      batch: { phase: Object.keys(b.phase)[0], totalQuote: b.totalQuote.toString(), quoteSpent: b.quoteSpent.toString(), baseReceived: b.baseReceived.toString(), settlerBounty: b.settlerBounty.toString() },
      minBaseOut: minBaseOut.toString(),
      openingFee: openingFee.toString(),
      settlerNetLamports: (eveAfter - eveBefore).toString(),
      creatorLamportDelta: ((await lamports(creator.publicKey)) - creatorBefore).toString(),
    };
    console.log("    settlement:", JSON.stringify(evidence.settlement));
    assert.equal(pool!.config, config.toBase58());
    assert.equal(pool!.baseMint, main.baseMint.toBase58());
    assert.equal(pool!.creator, creator.publicKey.toBase58(), "DBC creator role handed to the committed creator");
    assert.equal(pool!.hasSwap, 1);
    assert.equal(b.baseReceived.toString(), baseVault.toString());
    assert.equal(await tokenBalance(main.quoteVault), 0n);
    assert.equal(b.settlerBounty.toString(), "0");
    assert.equal(evidence.settlement.creatorLamportDelta, "0", "creator took no action and paid nothing");

    // The only successful transaction ever touching the pool is the settlement.
    const sigs = await connection.getSignaturesForAddress(main.pool, undefined, "confirmed");
    const okSigs = sigs.filter((s) => s.err === null).map((s) => s.signature);
    evidence.poolSuccessfulSignatures = okSigs;
    const griefSig = evidence.transactions.find((t: any) => t.label.startsWith("GRIEF")).signature;
    assert.deepEqual(okSigs.filter((s) => s !== griefSig), [entry.signature], "only the settlement (plus the lamport donation) touched the pool");
  });

  it("replay: settle cannot run again", async () => {
    await landTx("ATTACK replay settle", [cu(600_000), await settleIx(main, eve.publicKey)], [eve], /NotOpen/);
  });

  it("independent 1:2:3 claims; double-claim, outsider claim and vault theft fail; dust burn", async () => {
    await landTx("ATTACK creator SPL-transfers out of PDA base vault", [
      createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, getAssociatedTokenAddressSync(main.baseMint, creator.publicKey), creator.publicKey, main.baseMint),
      createTransferInstruction(main.baseVault, getAssociatedTokenAddressSync(main.baseMint, creator.publicKey), creator.publicKey, 1),
    ], [creator], /owner does not match/);
    await landTx("ATTACK eve claims alice's share", [await claimIx(main, eve, alice.publicKey)], [eve], /ConstraintSeeds/);
    await landTx("ATTACK eve claims without contribution", [await claimIx(main, eve)], [eve], /AccountNotInitialized/);
    await landTx("ATTACK burn_dust before all claims", [await burnDustIx(main)], [eve], /ClaimsOutstanding/);

    const received = BigInt((await (program.account as any).batch.fetch(main.batch)).baseReceived.toString());
    const claimed: Record<string, bigint> = {};
    for (const [name, w] of [["carol", carol], ["alice", alice], ["bob", bob]] as [string, Keypair][]) {
      await landTx(`claim ${name}`, [await claimIx(main, w)], [w]);
      claimed[name] = await tokenBalance(getAssociatedTokenAddressSync(main.baseMint, w.publicKey));
    }
    await landTx("ATTACK alice double-claims", [await claimIx(main, alice)], [alice], /AlreadyClaimed/);

    const expected = (amt: bigint) => (received * amt) / 600_000_000n;
    assert.equal(claimed.alice, expected(100_000_000n));
    assert.equal(claimed.bob, expected(200_000_000n));
    assert.equal(claimed.carol, expected(300_000_000n));
    const dust = await tokenBalance(main.baseVault);
    assert.equal(dust, received - claimed.alice - claimed.bob - claimed.carol);
    assert.isTrue(dust < 3n);
    evidence.balances.claims = { baseReceived: received.toString(), alice: claimed.alice.toString(), bob: claimed.bob.toString(), carol: claimed.carol.toString(), dustBeforeBurn: dust.toString() };
    console.log("    claims:", JSON.stringify(evidence.balances.claims));
    if (dust > 0n) {
      await landTx("burn_dust (permissionless, after all claims)", [await burnDustIx(main)], [eve]);
      assert.equal(await tokenBalance(main.baseVault), 0n);
    }
  });

  it("CREATOR ABANDONMENT + REFUND RECOVERY: unsettled batch expires, anyone cancels, everyone is refunded 1:1, bounty returns to creator", async () => {
    const before = { alice: await tokenBalance(wsolAta(alice.publicKey)), bob: await tokenBalance(wsolAta(bob.publicKey)), carol: await tokenBalance(wsolAta(carol.publicKey)) };
    await waitUntilChainTime(abandonedExpires);
    await landTx("ATTACK settle after expiry", [cu(600_000), await settleIx(abandoned, eve.publicKey)], [eve], /NotInSettlementWindow/);
    await landTx("ATTACK cancel_expired sending bounty to eve", [await cancelIx(abandoned, eve.publicKey)], [eve], /ConstraintAddress/);
    const creatorBefore = await lamports(creator.publicKey);
    await landTx("cancel_expired abandoned by eve (permissionless)", [await cancelIx(abandoned)], [eve]);
    assert.equal((await lamports(creator.publicKey)) - creatorBefore, BigInt(BOUNTY), "unused bounty returned to creator");
    await landTx("ATTACK cancel_expired twice", [await cancelIx(abandoned)], [eve], /NotOpen/);
    await landTx("ATTACK eve refunds alice's deposit to eve", [await refundIx(abandoned, eve, alice.publicKey, wsolAta(eve.publicKey))], [eve], /ConstraintSeeds/);
    await landTx("ATTACK alice refunds into eve's token account", [await refundIx(abandoned, alice, alice.publicKey, wsolAta(eve.publicKey))], [alice], /ConstraintTokenOwner/);
    await landTx("refund bob", [await refundIx(abandoned, bob)], [bob]);
    await landTx("refund alice", [await refundIx(abandoned, alice)], [alice]);
    await landTx("refund carol", [await refundIx(abandoned, carol)], [carol]);
    await landTx("ATTACK bob double-refund", [await refundIx(abandoned, bob)], [bob], /AlreadyRefunded/);

    // Underfunded batch (min raise never met) also recovers.
    await landTx("cancel_expired underfunded by eve", [await cancelIx(underfunded)], [eve]);
    await landTx("refund bob (underfunded)", [await refundIx(underfunded, bob)], [bob]);

    const after = { alice: await tokenBalance(wsolAta(alice.publicKey)), bob: await tokenBalance(wsolAta(bob.publicKey)), carol: await tokenBalance(wsolAta(carol.publicKey)) };
    assert.equal(after.alice - before.alice, BigInt(0.05 * SOL));
    assert.equal(after.bob - before.bob, BigInt(0.2 * SOL));
    assert.equal(after.carol - before.carol, BigInt(0.15 * SOL));
    assert.equal(await tokenBalance(abandoned.quoteVault), 0n);
    assert.equal(await tokenBalance(underfunded.quoteVault), 0n);
    evidence.balances.refunds = Object.fromEntries(Object.keys(after).map((k) => [k, ((after as any)[k] - (before as any)[k]).toString()]));
  });
});
