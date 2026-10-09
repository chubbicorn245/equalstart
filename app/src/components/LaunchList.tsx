import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchAllBatches, stageOf, type Batch } from "../lib/equalstart.ts";
import { useChainTime, useProgram } from "../hooks.ts";
import { STAGE_LABEL, duration, sol } from "../format.ts";
import { Progress } from "./Progress.tsx";

export function LaunchList() {
  const program = useProgram();
  const now = useChainTime();
  const { publicKey } = useWallet();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllBatches(program).then(setBatches, (e) => setError(String(e?.message ?? e)));
  }, [program]);

  return (
    <>
      <section className="hero">
        <h1>One opening buy, shared equally.</h1>
        <p>
          Participants pool SOL before a token exists. When the window closes, anyone can trigger settlement: one transaction
          creates the Meteora bonding-curve pool and spends the whole pool on its <strong>very first buy</strong>. Nobody can
          trade before the batch, and everyone in it gets the same average price. If settlement never happens, everyone gets
          a full refund.
        </p>
        <ol className="steps">
          <li><span>1</span>Creator commits the terms. They can't be changed afterwards.</li>
          <li><span>2</span>Wallets deposit SOL into a program-owned escrow</li>
          <li><span>3</span>Anyone settles: pool creation and the first buy happen together</li>
          <li><span>4</span>Each wallet claims tokens pro rata, or a refund after expiry</li>
        </ol>
      </section>

      <section>
        <div className="section-head">
          <h2>Launches</h2>
          <a className="button" href="#/create">New launch</a>
        </div>
        {error && <p className="error">Could not load launches: {error}</p>}
        {!batches && !error && <p className="muted">Loading launches…</p>}
        {batches?.length === 0 && <p className="muted">No launches yet on this network.</p>}
        <div className="grid">
          {batches?.map((b) => {
            const stage = now ? stageOf(b, now) : null;
            const next = stage === "deposits" ? b.closesAt : stage === "settlement" ? b.expiresAt : null;
            return (
              <a key={b.address.toBase58()} className="card launch-card" href={`#/launch/${b.address.toBase58()}`}>
                <div className="card-head">
                  <div>
                    <strong>{b.tokenName}</strong> <span className="muted">${b.tokenSymbol}</span>
                  </div>
                  {stage && <span className={`pill pill-${stage}`}>{STAGE_LABEL[stage]}</span>}
                </div>
                <Progress batch={b} compact />
                <div className="meta">
                  <span>{sol(b.totalQuote)} / {sol(b.maxPoolQuoteIn)} SOL</span>
                  <span>{b.participantsCount} {b.participantsCount === 1 ? "wallet" : "wallets"}</span>
                  {next && now && <span>{stage === "deposits" ? "closes" : "expires"} in {duration(next - now)}</span>}
                  {publicKey?.equals(b.creator) && <span className="tag">yours</span>}
                </div>
              </a>
            );
          })}
        </div>
      </section>
    </>
  );
}
