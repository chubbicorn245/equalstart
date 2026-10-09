// Labels every transaction of the given batches (slowly, one getTransaction at a time, to respect the
// public devnet RPC limits) and writes src/lib/activity-snapshot.json, which ships with the app.
//   RPC_URL=https://api.devnet.solana.com node --experimental-strip-types scripts/snapshot-activity.ts <batch> [<batch> …]
import fs from "node:fs";
import { Connection, PublicKey } from "@solana/web3.js";
import { labelTransaction, type ActivityLabel } from "../src/lib/equalstart.ts";

const connection = new Connection(process.env.RPC_URL ?? "https://api.devnet.solana.com", { commitment: "confirmed", disableRetryOnRateLimit: true });
const file = new URL("../src/lib/activity-snapshot.json", import.meta.url);
const snap: Record<string, ActivityLabel> = JSON.parse(fs.readFileSync(file, "utf8"));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const b of process.argv.slice(2)) {
  const sigs = await connection.getSignaturesForAddress(new PublicKey(b), { limit: 1000 });
  for (const s of sigs) {
    if (snap[s.signature]) continue;
    for (let wait = 1500; ; wait *= 2) {
      try {
        const l = await labelTransaction(connection, s.signature);
        if (l) snap[s.signature] = l;
        break;
      } catch {
        await sleep(wait);
      }
    }
    await sleep(1200);
  }
  console.log(b, sigs.length, "transactions");
  fs.writeFileSync(file, JSON.stringify(snap, null, 1));
}
