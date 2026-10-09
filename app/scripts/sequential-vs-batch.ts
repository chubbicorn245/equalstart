// Measures, on the real DBC program (localnet with the mainnet DBC binary), what
// Alice/Bob/Carol get if they buy 0.1/0.2/0.3 SOL one after another on a fresh
// pool, versus one 0.6 SOL EqualStart batch on the same config. Writes
// src/lib/comparison.json, which the home page renders.
//   RPC_URL=http://127.0.0.1:8899 node --experimental-strip-types scripts/sequential-vs-batch.ts
import fs from "node:fs";
import BN from "bn.js";
import { Connection, Keypair, LAMPORTS_PER_SOL, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, NATIVE_MINT } from "@solana/spl-token";
import { DynamicBondingCurveClient, deriveDbcPoolAddress } from "@meteora-ag/dynamic-bonding-curve-sdk";
import { createDbcConfigIxs } from "../src/lib/dbcConfig.ts";

const connection = new Connection(process.env.RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
const dbc = new DynamicBondingCurveClient(connection, "confirmed");

async function send(ixs: TransactionInstruction[], signers: Keypair[]) {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: signers[0].publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign(signers);
  const sig = await connection.sendRawTransaction(tx.serialize());
  const r = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (r.value.err) throw new Error(JSON.stringify(r.value.err));
}

const creator = Keypair.generate();
const SCALE = Number(process.env.SCALE ?? 1);
const buyers = ([["Alice", 0.1], ["Bob", 0.2], ["Carol", 0.3]] as const).map(([n, s]) => [n, Math.round(s * SCALE * 1000) / 1000] as const);
const wallets = buyers.map(() => Keypair.generate());
for (const w of [creator, ...wallets]) await connection.confirmTransaction(await connection.requestAirdrop(w.publicKey, (2 + SCALE) * LAMPORTS_PER_SOL), "confirmed");

const { config, ixs } = await createDbcConfigIxs(connection, creator.publicKey);
await send(ixs, [creator, config]);
const mint = Keypair.generate();
const create = await dbc.creator.createPool({ name: "Seq", symbol: "SEQ", uri: "", payer: creator.publicKey, poolCreator: creator.publicKey, config: config.publicKey, baseMint: mint.publicKey });
await send(create.instructions, [creator, mint]);
const pool = deriveDbcPoolAddress(NATIVE_MINT, mint.publicKey, config.publicKey);

const sequential = [];
for (const [i, [name, sol]] of buyers.entries()) {
  const w = wallets[i];
  const tx = await dbc.pool.swap({ owner: w.publicKey, pool, amountIn: new BN(sol * LAMPORTS_PER_SOL), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null });
  await send(tx.instructions, [w]);
  const raw = (await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint.publicKey, w.publicKey))).value.amount;
  const tokensPerSol = Number(raw) / 1e6 / sol;
  sequential.push({ name, sol, order: i + 1, tokens: raw, tokensPerSol: Math.round(tokensPerSol) });
  console.log(name, sol, raw, Math.round(tokensPerSol));
}

// One swap of the whole batch on a second fresh pool with the same config (what EqualStart's settle does).
const total = buyers.reduce((a, [, s]) => a + s, 0);
const batcher = Keypair.generate();
await connection.confirmTransaction(await connection.requestAirdrop(batcher.publicKey, (2 + total) * LAMPORTS_PER_SOL), "confirmed");
const mint2 = Keypair.generate();
await send((await dbc.creator.createPool({ name: "Bat", symbol: "BAT", uri: "", payer: creator.publicKey, poolCreator: creator.publicKey, config: config.publicKey, baseMint: mint2.publicKey })).instructions, [creator, mint2]);
const pool2 = deriveDbcPoolAddress(NATIVE_MINT, mint2.publicKey, config.publicKey);
await send((await dbc.pool.swap({ owner: batcher.publicKey, pool: pool2, amountIn: new BN(Math.round(total * LAMPORTS_PER_SOL)), minimumAmountOut: new BN(0), swapBaseForQuote: false, referralTokenAccount: null })).instructions, [batcher]);
const batchReceived = BigInt((await connection.getTokenAccountBalance(getAssociatedTokenAddressSync(mint2.publicKey, batcher.publicKey))).value.amount);
const totalLamports = BigInt(Math.round(total * 1e9));
const batch = buyers.map(([name, sol]) => {
  const raw = (batchReceived * BigInt(Math.round(sol * 1e9))) / totalLamports;
  return { name, sol, tokens: raw.toString(), tokensPerSol: Math.round(Number(raw) / 1e6 / sol) };
});
const out = {
  source: "Measured on the Meteora DBC mainnet binary (localnet), same config as the demo: flat 1% fee, 30→300 SOL market-cap curve.",
  sequential,
  batch,
};
const file = new URL("../src/lib/comparison.json", import.meta.url);
const all = fs.existsSync(file) && SCALE !== 1 ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
all[SCALE === 1 ? "demo" : `x${SCALE}`] = out;
fs.writeFileSync(file, JSON.stringify(all, null, 2));
console.log(JSON.stringify(out, null, 2));
