// Onchain tests for EqualStart against the REAL Meteora DBC program binary
// (dumped from mainnet, loaded into solana-test-validator). No mocks.
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
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
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
const EVIDENCE_DIR = path.resolve(__dirname, "../../evidence");
const DBC_PROGRAM_ID = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const DBC_POOL_AUTHORITY = new PublicKey("FhVo3mqL8PW5pH5U2CN4XE33DokiyZnUwuGpH2hmHLuM");
const DBC_EVENT_AUTHORITY = new PublicKey("8Ks12pbrD6PXxfty1hVQiE9sc289zgU1zHkvXhrSdriF");
const SWAP2_DISCRIMINATOR = Buffer.from([65, 75, 63, 76, 235, 91, 91, 136]);
const SOL = LAMPORTS_PER_SOL;

const connection = new Connection(RPC, "confirmed");
const dbc = new DynamicBondingCurveClient(connection, "confirmed");
const evidence: any = { rpc: RPC, startedAt: new Date().toISOString(), versions: {}, transactions: [], balances: {} };

const kp = () => Keypair.generate();
const partner = kp(), creator = kp(), alice = kp(), bob = kp(), carol = kp(), eve = kp();
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

async function landTx(label: string, ixs: TransactionInstruction[], signers: Keypair[], expectErr?: RegExp) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const msg = new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message();
  const tx = new VersionedTransaction(msg);
  tx.sign(signers);
  const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  const res = await connection.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const logs = res?.meta?.logMessages ?? [];
  const entry = {
    label,
    signature: sig,
    slot: res?.slot,
    ok: res?.meta?.err === null,
    err: res?.meta?.err ?? null,
    computeUnits: res?.meta?.computeUnitsConsumed,
    txBytes: tx.serialize().length,
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

async function airdrop(pk: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(pk, sol * SOL);
  await connection.confirmTransaction(sig, "confirmed");
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

const batchPda = (creatorPk: PublicKey, launchId: number) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("batch"), creatorPk.toBuffer(), new BN(launchId).toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID,
  )[0];
const quoteVaultPda = (batch: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("quote_vault"), batch.toBuffer()], PROGRAM_ID)[0];
const baseVaultPda = (batch: PublicKey) => PublicKey.findProgramAddressSync([Buffer.from("base_vault"), batch.toBuffer()], PROGRAM_ID)[0];
const contributionPda = (batch: PublicKey, who: PublicKey) =>
  PublicKey.findProgramAddressSync([Buffer.from("deposit"), batch.toBuffer(), who.toBuffer()], PROGRAM_ID)[0];

type BatchCtx = { launchId: number; batch: PublicKey; baseMint: Keypair; pool: PublicKey; quoteVault: PublicKey; baseVault: PublicKey };

function newBatchCtx(launchId: number, config: PublicKey, baseMint = kp()): BatchCtx {
  const batch = batchPda(creator.publicKey, launchId);
  return {
    launchId,
    batch,
    baseMint,
    pool: deriveDbcPoolAddress(NATIVE_MINT, baseMint.publicKey, config),
    quoteVault: quoteVaultPda(batch),
    baseVault: baseVaultPda(batch),
  };
}

async function initializeBatchIx(ctx: BatchCtx, config: PublicKey, t: { closesAt: number; expiresAt: number; minBaseOut: BN; maxPoolQuoteIn?: BN }) {
  return program.methods
    .initializeBatch({
      launchId: new BN(ctx.launchId),
      baseMint: ctx.baseMint.publicKey,
      closesAt: new BN(t.closesAt),
      expiresAt: new BN(t.expiresAt),
      perWalletCap: new BN(0.5 * SOL),
      minRaise: new BN(0.05 * SOL),
      maxPoolQuoteIn: t.maxPoolQuoteIn ?? new BN(2 * SOL),
      minBaseOut: t.minBaseOut,
    })
    .accountsStrict({
      creator: creator.publicKey,
      batch: ctx.batch,
      quoteMint: NATIVE_MINT,
      quoteVault: ctx.quoteVault,
      dbcConfig: config,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

const depositIx = (ctx: BatchCtx, who: Keypair, lamports: number, contributionOwner = who.publicKey) =>
  program.methods
    .deposit(new BN(lamports))
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

const withdrawIx = (ctx: BatchCtx, who: Keypair, lamports: number, contributionOwner = who.publicKey, dest = wsolAta(who.publicKey)) =>
  program.methods
    .withdraw(new BN(lamports))
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

function executeIx(ctx: BatchCtx, config: PublicKey, payer: PublicKey, pool = ctx.pool, baseMint = ctx.baseMint.publicKey) {
  return program.methods
    .executeBatch()
    .accountsStrict({
      payer,
      batch: ctx.batch,
      quoteVault: ctx.quoteVault,
      baseVault: ctx.baseVault,
      baseMint,
      quoteMint: NATIVE_MINT,
      pool,
      dbcConfig: config,
      dbcBaseVault: deriveDbcTokenVaultAddress(pool, baseMint),
      dbcQuoteVault: deriveDbcTokenVaultAddress(pool, NATIVE_MINT),
      dbcPoolAuthority: DBC_POOL_AUTHORITY,
      dbcEventAuthority: DBC_EVENT_AUTHORITY,
      dbcProgram: DBC_PROGRAM_ID,
      instructionsSysvar: SYSVAR_INSTRUCTIONS_PUBKEY,
      tokenProgram: TOKEN_PROGRAM_ID,
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
      baseMint: ctx.baseMint.publicKey,
      participantBase: getAssociatedTokenAddressSync(ctx.baseMint.publicKey, who.publicKey),
      tokenProgram: TOKEN_PROGRAM_ID,
      associatedTokenProgram: new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
      systemProgram: SystemProgram.programId,
    })
    .instruction();

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

/** SDK-built DBC `initialize_virtual_pool_with_spl_token` instruction (exactly one). */
async function sdkPoolInitIx(config: PublicKey, baseMint: PublicKey) {
  const tx = await dbc.creator.createPool({
    name: "EqualStart Test",
    symbol: "EQS",
    uri: "https://example.invalid/eqs.json",
    payer: creator.publicKey,
    poolCreator: creator.publicKey,
    config,
    baseMint,
  });
  const ixs = tx.instructions.filter((ix) => ix.programId.equals(DBC_PROGRAM_ID));
  assert.equal(ixs.length, 1, "expected exactly one DBC instruction from createPool");
  assert.equal(tx.instructions.length, 1, `SDK createPool returned extra instructions: ${tx.instructions.map((i) => i.programId.toBase58())}`);
  return ixs[0];
}

/** Raw DBC swap2 ExactIn signed by an external wallet (used only by the attacker). */
function rawSwap2Ix(pool: PublicKey, config: PublicKey, baseMint: PublicKey, user: PublicKey, amountIn: number) {
  const data = Buffer.alloc(8 + 8 + 8 + 1);
  SWAP2_DISCRIMINATOR.copy(data, 0);
  data.writeBigUInt64LE(BigInt(amountIn), 8);
  data.writeBigUInt64LE(0n, 16);
  data.writeUInt8(0, 24);
  const k = (pubkey: PublicKey, isWritable = false, isSigner = false) => ({ pubkey, isWritable, isSigner });
  return new TransactionInstruction({
    programId: DBC_PROGRAM_ID,
    keys: [
      k(DBC_POOL_AUTHORITY),
      k(config),
      k(pool, true),
      k(wsolAta(user), true),
      k(getAssociatedTokenAddressSync(baseMint, user), true),
      k(deriveDbcTokenVaultAddress(pool, baseMint), true),
      k(deriveDbcTokenVaultAddress(pool, NATIVE_MINT), true),
      k(baseMint),
      k(NATIVE_MINT),
      k(user, false, true),
      k(TOKEN_PROGRAM_ID),
      k(TOKEN_PROGRAM_ID),
      k(DBC_PROGRAM_ID),
      k(DBC_EVENT_AUTHORITY),
      k(DBC_PROGRAM_ID),
    ],
    data,
  });
}

async function readPool(pool: PublicKey) {
  const info = await connection.getAccountInfo(pool, "confirmed");
  if (!info) return null;
  const d = info.data;
  return {
    owner: info.owner.toBase58(),
    config: new PublicKey(d.subarray(72, 104)).toBase58(),
    baseMint: new PublicKey(d.subarray(136, 168)).toBase58(),
    baseReserve: d.readBigUInt64LE(232).toString(),
    quoteReserve: d.readBigUInt64LE(240).toString(),
    hasSwap: d[370],
  };
}

const cu = (units: number) => ComputeBudgetProgram.setComputeUnitLimit({ units });

// ---------- tests ----------

describe("EqualStart x Meteora DBC (localnet, real DBC binary)", function () {
  this.timeout(10 * 60 * 1000);

  const configKp = kp();
  const config = configKp.publicKey;
  let main: BatchCtx; // Alice/Bob/Carol 0.1/0.2/0.3 -> atomic settlement
  let expiring: BatchCtx; // refund scenario
  let slippage: BatchCtx; // atomic rollback when DBC output < committed minimum
  let mainCloses = 0;
  let expiringExpires = 0;

  after(() => {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
    evidence.finishedAt = new Date().toISOString();
    const out = path.join(EVIDENCE_DIR, process.env.EVIDENCE_NAME ?? "localnet-run.json");
    fs.writeFileSync(out, JSON.stringify(evidence, null, 2));
    console.log(`\n    evidence written to ${out}`);
  });

  it("pins versions and verifies the real DBC + EqualStart programs are deployed", async () => {
    const pkgJson = (name: string) => JSON.parse(fs.readFileSync(path.join(__dirname, "../node_modules", name, "package.json"), "utf8"));
    const sdkPkg = pkgJson("@meteora-ag/dynamic-bonding-curve-sdk");
    const dbcIdl = require("../../idl/dynamic_bonding_curve.json");
    evidence.versions = {
      dbcSdk: sdkPkg.version,
      dbcIdl: dbcIdl.metadata.version,
      anchorClient: pkgJson("@anchor-lang/core").version,
      solanaCore: (await connection.getVersion())["solana-core"],
      equalstartProgram: PROGRAM_ID.toBase58(),
      swap2Accounts: dbcIdl.instructions.find((i: any) => i.name === "swap2").accounts.map((a: any) => `${a.name}${a.writable ? "(w)" : ""}${a.signer ? "(signer)" : ""}${a.optional ? "(optional)" : ""}`),
      swap2Args: "SwapParameters2 { amount_0: u64, amount_1: u64, swap_mode: u8 }",
    };
    console.log("    versions:", JSON.stringify(evidence.versions, null, 1));
    assert.equal(sdkPkg.version, "1.5.13");
    for (const id of [DBC_PROGRAM_ID, PROGRAM_ID, new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s")]) {
      const info = await connection.getAccountInfo(id);
      assert.isTrue(info?.executable, `${id.toBase58()} not deployed`);
    }
  });

  it("funds wallets and creates a DBC config with first-swap-min-fee and rate limiter disabled (SDK)", async () => {
    for (const w of [partner, creator, alice, bob, carol, eve]) await airdrop(w.publicKey, 10);
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
          feeSchedulerParam: { startingFeeBps: 100, endingFeeBps: 100, numberOfPeriod: 0, totalDuration: 0 },
        },
        dynamicFeeEnabled: false,
        collectFeeMode: CollectFeeMode.QuoteToken,
        creatorTradingFeePercentage: 0,
        poolCreationFee: 0,
        enableFirstSwapWithMinFee: false,
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
      config,
      feeClaimer: partner.publicKey,
      leftoverReceiver: partner.publicKey,
      quoteMint: NATIVE_MINT,
      payer: partner.publicKey,
      ...curve,
    });
    await landTx("dbc.create_config (SDK)", tx.instructions, [partner, configKp]);
    const d = (await connection.getAccountInfo(config))!.data;
    evidence.dbcConfig = {
      address: config.toBase58(),
      quoteMint: new PublicKey(d.subarray(8, 40)).toBase58(),
      baseFeeMode: d[130],
      enableFirstSwapWithMinFee: d[365],
      tokenType: d[237],
      migrationQuoteThreshold: d.readBigUInt64LE(264).toString(),
    };
    console.log("    config:", JSON.stringify(evidence.dbcConfig));
    assert.equal(d[365], 0);
    assert.notEqual(d[130], 2);
  });

  it("initializes batches with immutable terms; rejects bad config and re-initialization", async () => {
    const now = await chainTime();
    mainCloses = now + 25;
    expiringExpires = now + 45;
    main = newBatchCtx(1, config);
    expiring = newBatchCtx(2, config);
    slippage = newBatchCtx(3, config);
    await landTx("initialize_batch main", [await initializeBatchIx(main, config, { closesAt: mainCloses, expiresAt: now + 600, minBaseOut: new BN(1_000_000) })], [creator]);
    await landTx("initialize_batch expiring", [await initializeBatchIx(expiring, config, { closesAt: now + 20, expiresAt: expiringExpires, minBaseOut: new BN(1) })], [creator]);
    await landTx(
      "initialize_batch slippage (min_base_out = u64::MAX/2)",
      [await initializeBatchIx(slippage, config, { closesAt: mainCloses, expiresAt: now + 600, minBaseOut: new BN("9223372036854775807") })],
      [creator],
    );

    // Same launch id again -> account already exists, terms cannot be rewritten.
    await landTx(
      "ATTACK re-initialize main batch with new terms",
      [await initializeBatchIx(main, config, { closesAt: now + 1000, expiresAt: now + 5000, minBaseOut: new BN(1) })],
      [creator],
      /already in use/,
    );
    // A config not owned by DBC (here: a random system account) is rejected.
    const fake = newBatchCtx(4, eve.publicKey);
    await landTx(
      "ATTACK initialize_batch with non-DBC config",
      [await initializeBatchIx(fake, eve.publicKey, { closesAt: now + 100, expiresAt: now + 200, minBaseOut: new BN(1) })],
      [creator],
      /InvalidDbcConfig/,
    );
    // A batch big enough to complete the DBC curve (>= migration_quote_threshold) is rejected up front.
    const huge = newBatchCtx(5, config);
    await landTx(
      "ATTACK initialize_batch with max_pool_quote_in >= DBC migration threshold",
      [await initializeBatchIx(huge, config, { closesAt: now + 100, expiresAt: now + 200, minBaseOut: new BN(1), maxPoolQuoteIn: new BN("100000000000") })],
      [creator],
      /BadTerms/,
    );
    const b: any = await (program.account as any).batch.fetch(main.batch);
    assert.equal(b.pool.toBase58(), main.pool.toBase58());
    assert.equal(b.dbcConfig.toBase58(), config.toBase58());
    evidence.mainBatch = { batch: main.batch.toBase58(), pool: main.pool.toBase58(), baseMint: main.baseMint.publicKey.toBase58(), quoteVault: main.quoteVault.toBase58(), baseVault: main.baseVault.toBase58() };
  });

  it("Alice 0.1, Bob 0.2, Carol 0.3 wSOL deposit with their own signatures; caps/withdraw/theft attempts fail", async () => {
    for (const [w, sol] of [[alice, 1], [bob, 1], [carol, 1]] as [Keypair, number][]) {
      await landTx(`wrap ${sol} SOL`, wrapIxs(w.publicKey, sol * SOL), [w]);
    }
    await landTx("deposit alice 0.15 (main)", [await depositIx(main, alice, 0.15 * SOL)], [alice]);
    await landTx("withdraw alice 0.05 before close (main)", [await withdrawIx(main, alice, 0.05 * SOL)], [alice]);
    await landTx("deposit bob 0.2 (main)", [await depositIx(main, bob, 0.2 * SOL)], [bob]);
    await landTx("deposit carol 0.3 (main)", [await depositIx(main, carol, 0.3 * SOL)], [carol]);
    await landTx("deposit alice 0.05 (expiring)", [await depositIx(expiring, alice, 0.05 * SOL)], [alice]);
    await landTx("deposit bob 0.1 (expiring)", [await depositIx(expiring, bob, 0.1 * SOL)], [bob]);
    await landTx("deposit carol 0.15 (expiring)", [await depositIx(expiring, carol, 0.15 * SOL)], [carol]);
    await landTx("deposit alice 0.1 (slippage)", [await depositIx(slippage, alice, 0.1 * SOL)], [alice]);

    await landTx("ATTACK refund before cancellation", [await refundIx(expiring, alice)], [alice], /NotCancelled/);
    await landTx("ATTACK cancel_expired before expiry", [await program.methods.cancelExpired().accountsStrict({ batch: expiring.batch }).instruction()], [eve], /NotExpired/);
    await landTx("ATTACK carol exceeds per-wallet cap", [await depositIx(main, carol, 0.25 * SOL)], [carol], /WalletCapExceeded/);
    await landTx("ATTACK eve withdraws from alice's contribution", [await withdrawIx(main, eve, 0.1 * SOL, alice.publicKey, wsolAta(alice.publicKey))], [eve], /ConstraintSeeds|AccountNotInitialized/);
    await landTx(
      "ATTACK creator SPL-transfers out of PDA quote vault",
      [
        ...wrapIxs(creator.publicKey, 1000),
        createTransferInstruction(main.quoteVault, wsolAta(creator.publicKey), creator.publicKey, 0.6 * SOL),
      ],
      [creator],
      /owner does not match/,
    );
    await landTx("ATTACK execute_batch before closes_at (with real pool init)", [cu(400_000), await sdkPoolInitIx(config, main.baseMint.publicKey), await executeIx(main, config, creator.publicKey)], [creator, main.baseMint], /NotInSettlementWindow/);
    assert.isNull(await connection.getAccountInfo(main.pool), "pool must not exist after the reverted tx");

    assert.equal(await tokenBalance(main.quoteVault), BigInt(0.6 * SOL));
    const b: any = await (program.account as any).batch.fetch(main.batch);
    assert.equal(b.totalQuote.toString(), String(0.6 * SOL));
    assert.equal(b.participantsCount, 3);
  });

  it("rejects settlements that are not init-immediately-then-execute for the committed pool", async () => {
    await waitUntilChainTime(mainCloses);
    // (a) execute alone, no pool init in the transaction
    await landTx("ATTACK execute_batch without pool init", [await executeIx(main, config, eve.publicKey)], [eve], /AccountNotInitialized|PoolNotCreatedAtomically/);

    // (b) attacker inserts their own buy between pool init and execute_batch
    await landTx("wrap eve 1 SOL", wrapIxs(eve.publicKey, 1 * SOL), [eve]);
    await landTx(
      "ATTACK init -> eve swap2 first buy -> execute_batch",
      [
        cu(600_000),
        await sdkPoolInitIx(config, main.baseMint.publicKey),
        createAssociatedTokenAccountIdempotentInstruction(eve.publicKey, getAssociatedTokenAddressSync(main.baseMint.publicKey, eve.publicKey), eve.publicKey, main.baseMint.publicKey),
        rawSwap2Ix(main.pool, config, main.baseMint.publicKey, eve.publicKey, 0.5 * SOL),
        await executeIx(main, config, creator.publicKey),
      ],
      [creator, main.baseMint, eve],
      /PoolNotCreatedAtomically/,
    );
    assert.isNull(await connection.getAccountInfo(main.pool));

    // (c) init a pool for an uncommitted base mint and point execute_batch at it
    const rogueMint = kp();
    const roguePool = deriveDbcPoolAddress(NATIVE_MINT, rogueMint.publicKey, config);
    await landTx(
      "ATTACK init uncommitted pool -> execute_batch against it",
      [cu(400_000), await sdkPoolInitIx(config, rogueMint.publicKey), await executeIx(main, config, creator.publicKey, roguePool, rogueMint.publicKey)],
      [creator, rogueMint],
      /ConstraintAddress/,
    );
    assert.equal(await tokenBalance(main.quoteVault), BigInt(0.6 * SOL));
  });

  it("SLIPPAGE: atomic init+execute reverts entirely when DBC output < committed min_base_out", async () => {
    await landTx(
      "settlement tx (slippage batch) init + execute_batch",
      [cu(400_000), await sdkPoolInitIx(config, slippage.baseMint.publicKey), await executeIx(slippage, config, creator.publicKey)],
      [creator, slippage.baseMint],
      /ExceededSlippage/,
    );
    assert.isNull(await connection.getAccountInfo(slippage.pool), "pool creation must roll back with the failed swap");
    assert.equal(await tokenBalance(slippage.quoteVault), BigInt(0.1 * SOL));
  });

  it("SETTLEMENT: ONE transaction = SDK DBC pool init + EqualStart execute_batch (PDA-signed swap2 CPI)", async () => {
    const initIx = await sdkPoolInitIx(config, main.baseMint.publicKey);
    const execIx = await executeIx(main, config, creator.publicKey);

    // Simulate first with max CU to measure.
    const { blockhash } = await connection.getLatestBlockhash("confirmed");
    const simMsg = new TransactionMessage({ payerKey: creator.publicKey, recentBlockhash: blockhash, instructions: [cu(1_400_000), initIx, execIx] }).compileToV0Message();
    const simTx = new VersionedTransaction(simMsg);
    simTx.sign([creator, main.baseMint]);
    const sim = await connection.simulateTransaction(simTx, { sigVerify: true });
    evidence.settlementSimulation = {
      err: sim.value.err,
      unitsConsumed: sim.value.unitsConsumed,
      txBytes: simTx.serialize().length,
      txByteLimit: 1232,
      accountKeys: simMsg.staticAccountKeys.length,
      logs: sim.value.logs,
    };
    console.log(`    simulation: err=${JSON.stringify(sim.value.err)} CU=${sim.value.unitsConsumed} bytes=${simTx.serialize().length}/1232 keys=${simMsg.staticAccountKeys.length}`);
    assert.isNull(sim.value.err, (sim.value.logs ?? []).join("\n"));

    const vaultBefore = await tokenBalance(main.quoteVault);
    const cuLimit = Math.ceil(sim.value.unitsConsumed! * 1.2);
    const entry = await landTx("SETTLEMENT init_pool + execute_batch", [cu(cuLimit), initIx, execIx], [creator, main.baseMint]);
    evidence.settlementSignature = entry.signature;
    const logs = entry.logs.join("\n");

    // Proof from logs: top-level DBC init, top-level EqualStart, DBC swap2 invoked at CPI depth 2 by EqualStart.
    assert.match(logs, new RegExp(`Program ${DBC_PROGRAM_ID.toBase58()} invoke \\[1\\]\\nProgram log: Instruction: InitializeVirtualPoolWithSplToken`));
    assert.match(logs, new RegExp(`Program ${PROGRAM_ID.toBase58()} invoke \\[1\\]\\nProgram log: Instruction: ExecuteBatch`));
    assert.match(logs, new RegExp(`Program ${DBC_PROGRAM_ID.toBase58()} invoke \\[2\\]\\nProgram log: Instruction: Swap2`));
    assert.match(logs, /EqualStart settled: quote_spent=600000000 base_received=\d+/);

    const pool = await readPool(main.pool);
    const b: any = await (program.account as any).batch.fetch(main.batch);
    const baseVault = await tokenBalance(main.baseVault);
    evidence.settlement = {
      pool,
      quoteVaultBefore: vaultBefore.toString(),
      quoteVaultAfter: (await tokenBalance(main.quoteVault)).toString(),
      batchBaseVault: baseVault.toString(),
      batch: { phase: Object.keys(b.phase)[0], totalQuote: b.totalQuote.toString(), quoteSpent: b.quoteSpent.toString(), baseReceived: b.baseReceived.toString() },
    };
    console.log("    settlement:", JSON.stringify(evidence.settlement));
    assert.equal(pool!.config, config.toBase58());
    assert.equal(pool!.baseMint, main.baseMint.publicKey.toBase58());
    assert.equal(pool!.hasSwap, 1);
    assert.equal(b.quoteSpent.toString(), String(0.6 * SOL));
    assert.equal(b.baseReceived.toString(), baseVault.toString());
    assert.isTrue(baseVault > 0n);
    assert.equal(await tokenBalance(main.quoteVault), 0n);

    // Exactly one swap ever happened on this pool: the batch's. Check signatures touching the pool.
    const sigs = await connection.getSignaturesForAddress(main.pool, undefined, "confirmed");
    const okSigs = sigs.filter((s) => s.err === null).map((s) => s.signature);
    evidence.poolSuccessfulSignatures = okSigs;
    assert.deepEqual(okSigs, [entry.signature], "the only successful tx touching the pool must be the settlement");
  });

  it("replay: settlement and execute_batch cannot run again", async () => {
    await landTx("ATTACK replay execute_batch alone", [await executeIx(main, config, eve.publicKey)], [eve], /already in use|NotOpen/);
    await landTx(
      "ATTACK replay full settlement tx (new blockhash)",
      [cu(400_000), await sdkPoolInitIx(config, main.baseMint.publicKey), await executeIx(main, config, creator.publicKey)],
      [creator, main.baseMint],
      /already in use/,
    );
  });

  it("independent 1:2:3 claims; double-claim, outsider claim and vault theft fail; dust burn", async () => {
    await landTx("ATTACK creator SPL-transfers out of PDA base vault", [
      createAssociatedTokenAccountIdempotentInstruction(creator.publicKey, getAssociatedTokenAddressSync(main.baseMint.publicKey, creator.publicKey), creator.publicKey, main.baseMint.publicKey),
      createTransferInstruction(main.baseVault, getAssociatedTokenAddressSync(main.baseMint.publicKey, creator.publicKey), creator.publicKey, 1),
    ], [creator], /owner does not match/);
    await landTx("ATTACK eve claims alice's share", [await claimIx(main, eve, alice.publicKey)], [eve], /ConstraintSeeds/);
    await landTx("ATTACK eve claims without contribution", [await claimIx(main, eve)], [eve], /AccountNotInitialized/);
    await landTx("ATTACK burn_dust before all claims", [
      await program.methods.burnDust().accountsStrict({ batch: main.batch, baseVault: main.baseVault, baseMint: main.baseMint.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).instruction(),
    ], [eve], /ClaimsOutstanding/);

    const received = BigInt((await (program.account as any).batch.fetch(main.batch)).baseReceived.toString());
    const claimed: Record<string, bigint> = {};
    for (const [name, w] of [["carol", carol], ["alice", alice], ["bob", bob]] as [string, Keypair][]) {
      await landTx(`claim ${name}`, [await claimIx(main, w)], [w]);
      claimed[name] = await tokenBalance(getAssociatedTokenAddressSync(main.baseMint.publicKey, w.publicKey));
    }
    await landTx("ATTACK alice double-claims", [await claimIx(main, alice)], [alice], /AlreadyClaimed/);

    const expected = (amt: bigint) => (received * amt) / 600_000_000n;
    assert.equal(claimed.alice, expected(100_000_000n));
    assert.equal(claimed.bob, expected(200_000_000n));
    assert.equal(claimed.carol, expected(300_000_000n));
    assert.isTrue(claimed.bob - 2n * claimed.alice <= 1n && 2n * claimed.alice - claimed.bob <= 1n);
    assert.isTrue(claimed.carol - 3n * claimed.alice <= 2n && 3n * claimed.alice - claimed.carol <= 2n);
    const dust = await tokenBalance(main.baseVault);
    assert.equal(dust, received - claimed.alice - claimed.bob - claimed.carol);
    assert.isTrue(dust < 3n);
    evidence.balances.claims = { baseReceived: received.toString(), alice: claimed.alice.toString(), bob: claimed.bob.toString(), carol: claimed.carol.toString(), dustBeforeBurn: dust.toString() };
    console.log("    claims:", JSON.stringify(evidence.balances.claims));

    if (dust > 0n) {
      await landTx("burn_dust (permissionless, after all claims)", [
        await program.methods.burnDust().accountsStrict({ batch: main.batch, baseVault: main.baseVault, baseMint: main.baseMint.publicKey, tokenProgram: TOKEN_PROGRAM_ID }).instruction(),
      ], [eve]);
      assert.equal(await tokenBalance(main.baseVault), 0n);
    }
  });

  it("REFUND: expired batch is cancelled by anyone and refunded 1:1 without creator consent", async () => {
    const before = {
      alice: await tokenBalance(wsolAta(alice.publicKey)),
      bob: await tokenBalance(wsolAta(bob.publicKey)),
      carol: await tokenBalance(wsolAta(carol.publicKey)),
    };
    await waitUntilChainTime(expiringExpires);
    await landTx("ATTACK execute_batch after expiry", [cu(400_000), await sdkPoolInitIx(config, expiring.baseMint.publicKey), await executeIx(expiring, config, creator.publicKey)], [creator, expiring.baseMint], /NotInSettlementWindow/);
    await landTx("cancel_expired by eve (permissionless)", [await program.methods.cancelExpired().accountsStrict({ batch: expiring.batch }).instruction()], [eve]);
    await landTx("ATTACK eve refunds alice's deposit to eve", [await refundIx(expiring, eve, alice.publicKey, wsolAta(eve.publicKey))], [eve], /ConstraintSeeds/);
    await landTx("ATTACK alice refunds into eve's token account", [await refundIx(expiring, alice, alice.publicKey, wsolAta(eve.publicKey))], [alice], /ConstraintTokenOwner/);
    await landTx("refund bob", [await refundIx(expiring, bob)], [bob]);
    await landTx("refund alice", [await refundIx(expiring, alice)], [alice]);
    await landTx("refund carol", [await refundIx(expiring, carol)], [carol]);
    await landTx("ATTACK bob double-refund", [await refundIx(expiring, bob)], [bob], /AlreadyRefunded/);

    const after = {
      alice: await tokenBalance(wsolAta(alice.publicKey)),
      bob: await tokenBalance(wsolAta(bob.publicKey)),
      carol: await tokenBalance(wsolAta(carol.publicKey)),
    };
    assert.equal(after.alice - before.alice, BigInt(0.05 * SOL));
    assert.equal(after.bob - before.bob, BigInt(0.1 * SOL));
    assert.equal(after.carol - before.carol, BigInt(0.15 * SOL));
    assert.equal(await tokenBalance(expiring.quoteVault), 0n);
    evidence.balances.refunds = Object.fromEntries(Object.keys(after).map((k) => [k, ((after as any)[k] - (before as any)[k]).toString()]));
  });
});
