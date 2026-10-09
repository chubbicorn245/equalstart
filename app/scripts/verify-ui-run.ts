import { Connection, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { makeProgram, fetchBatch, fetchContributions, claimableShare } from "../src/lib/equalstart.ts";
const c = new Connection("https://api.devnet.solana.com", "confirmed");
const program = makeProgram(c);
const W: Record<string,string> = { Creator: "9FvYgiyz3Zmyb7CrthVcuTw3Z6DFcn4X8yHtA5LeA1rp", Bob: "6bsT9SHc4R6RYSsgKjo3vYYKK8tLpiS3oQW1Gy7JLyrJ", Carol: "8N1yZs5DemFVwdM4zQ1z425eUAm9BsGYUzNxed8TxZBG", Settler: "715B3SUPhreKRxZPxJp5eC2zy71WC3kPRg81V6zPqVyF" };
const name = (k: PublicKey) => Object.entries(W).find(([, v]) => v === k.toBase58())?.[0] ?? k.toBase58();
for (const addr of ["BJDWdVWwgxrAjxabZdWXm2jyqkJwQBTAoduC2ToR5BXV", "CugJXmU56pGHF9CBQX8Cki97GBdmYx9Viqmuepij3CU2"]) {
  const b: any = await fetchBatch(program, new PublicKey(addr));
  console.log(`\n${b.tokenName} ${addr}\n phase=${b.phase} total=${b.totalQuote} participants=${b.participantsCount} baseReceived=${b.baseReceived} mint=${b.baseMint?.toBase58?.() ?? ""} uri=${b.tokenUri}`);
  for (const r of await fetchContributions(program, b.address)) {
    let bal = "";
    if (b.phase === "settled") { const ata = getAssociatedTokenAddressSync(b.baseMint, r.participant); const t = await c.getTokenAccountBalance(ata).catch(() => null); bal = ` wallet EQUAL raw=${t?.value.amount} expected=${claimableShare(b, r)}`; }
    console.log(`  ${name(r.participant)} deposit=${r.amount} claimed=${r.claimed} refunded=${r.refunded}${bal}`);
  }
  const sigs = await c.getSignaturesForAddress(new PublicKey(addr), { limit: 50 });
  console.log(" txs (oldest first):"); for (const s of sigs.reverse()) console.log(`  ${s.err ? "FAIL" : "ok  "} ${s.signature}`);
}
for (const [n, a] of Object.entries(W)) console.log(`${n} SOL=${(await c.getBalance(new PublicKey(a))) / 1e9}`);
