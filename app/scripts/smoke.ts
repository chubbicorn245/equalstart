// Headless end-to-end check of the app's client library (src/lib) against a
// live cluster: create config + launch, three deposits, settle by a stranger,
// three claims. Uses the exact instruction builders the UI uses.
//   RPC_URL=http://127.0.0.1:8899 npm run smoke                 (localnet, airdrops)
//   RPC_URL=https://api.devnet.solana.com FUNDER_KEYPAIR=../keys/deployer.json npm run smoke
import fs from "node:fs";
import BN from "bn.js";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as es from "../src/lib/equalstart.ts";
import { createDbcConfigIxs } from "../src/lib/dbcConfig.ts";

const RPC = process.env.RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(RPC, "confirmed");
const program = es.makeProgram(connection);
const SOL = LAMPORTS_PER_SOL;
const funder = process.env.FUNDER_KEYPAIR ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.FUNDER_KEYPAIR, "utf8")))) : null;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chainTime = async () => (await connection.getBlockTime(await connection.getSlot("confirmed")))!;

async function send(label: string, ixs: TransactionInstruction[], signers: Keypair[]) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign(signers);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (res.value.err) throw new Error(`${label} failed: ${JSON.stringify(res.value.err)} ${sig}`);
  console.log(`ok  ${label.padEnd(28)} ${sig}`);
  return sig;
}

async function fund(pk: PublicKey, sol: number) {
  if (funder) return send(`fund ${pk.toBase58().slice(0, 6)}`, [SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: pk, lamports: Math.round(sol * SOL) })], [funder]);
  await connection.confirmTransaction(await connection.requestAirdrop(pk, sol * SOL), "confirmed");
}

const [creator, alice, bob, carol, stranger] = Array.from({ length: 5 }, () => Keypair.generate());
await fund(creator.publicKey, 0.3);
for (const w of [alice, bob, carol]) await fund(w.publicKey, 0.35);
await fund(stranger.publicKey, 0.05);

const { config, ixs: configIxs } = await createDbcConfigIxs(connection, creator.publicKey);
await send("create DBC config", configIxs, [creator, config]);
const cfg = await es.readDbcConfig(connection, config.publicKey);
console.log("    config", config.publicKey.toBase58(), JSON.stringify({ cliffFeeBps: cfg!.cliffFeeBps, firstSwapMinFee: cfg!.firstSwapMinFee }));

const now = await chainTime();
const terms: es.LaunchTerms = {
  launchId: new BN(Date.now()),
  closesAt: now + 40,
  expiresAt: now + 3600,
  perWalletCap: new BN(0.5 * SOL),
  minRaise: new BN(0.1 * SOL),
  maxPoolQuoteIn: new BN(1 * SOL),
  minBasePerSol: new BN("30000000000000"),
  maxOpeningFeeBps: 100,
  settlerBounty: new BN(0.03 * SOL),
  tokenName: "EqualStart Smoke",
  tokenSymbol: "EQSM",
  tokenUri: "https://example.invalid/eqsm.json",
};
const { batch: batchAddr, ixs } = await es.initializeBatchIxs(program, creator.publicKey, config.publicKey, terms);
await send("initialize_batch", ixs, [creator]);
let batch = (await es.fetchBatch(program, batchAddr))!;

for (const [w, sol] of [[alice, 0.1], [bob, 0.2], [carol, 0.3]] as [Keypair, number][]) {
  await send(`deposit ${sol} SOL`, await es.depositIxs(program, batch, w.publicKey, new BN(sol * SOL)), [w]);
}
batch = (await es.fetchBatch(program, batchAddr))!;
console.log(`    raised ${batch.totalQuote.toString()} from ${batch.participantsCount} wallets; stage=${es.stageOf(batch, await chainTime())}`);

while ((await chainTime()) < batch.closesAt) await sleep(2000);
await send("settle (stranger)", await es.settleIxs(program, batch, stranger.publicKey), [stranger]);
batch = (await es.fetchBatch(program, batchAddr))!;
console.log(`    settled: quote_spent=${batch.quoteSpent} base_received=${batch.baseReceived} pool=${batch.pool.toBase58()}`);

for (const w of [alice, bob, carol]) {
  const c = (await es.fetchContribution(program, batchAddr, w.publicKey))!;
  const expected = es.claimableShare(batch, c);
  await send("claim", await es.claimIxs(program, batch, w.publicKey), [w]);
  const got = (await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(batch.baseMint, w.publicKey))).value.amount;
  if (got !== expected.toString()) throw new Error(`claim mismatch: expected ${expected} got ${got}`);
  console.log(`    ${w.publicKey.toBase58().slice(0, 6)} claimed ${got} (matches client-side share)`);
}
console.log("SMOKE PASS", batchAddr.toBase58());
