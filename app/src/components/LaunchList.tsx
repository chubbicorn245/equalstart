import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { fetchAllBatches, stageOf, type Batch } from "../lib/equalstart.ts";
import { FEATURED_BATCH, useChainTime, useProgram } from "../hooks.ts";
import { STAGE_LABEL, duration, sol, tokens } from "../format.ts";
import { Progress } from "./Progress.tsx";
import { Comparison } from "./Comparison.tsx";
import { HowItWorks } from "./HowItWorks.tsx";

function LaunchCard({ b, now, featured = false }: { b: Batch; now: number | null; featured?: boolean }) {
  const { publicKey } = useWallet();
  const stage = now ? stageOf(b, now) : null;
  const next = stage === "deposits" ? b.closesAt : stage === "settlement" ? b.expiresAt : null;
  return (
    <a className={`card launch-card ${featured ? "featured" : ""}`} href={`#/launch/${b.address.toBase58()}`}>
      <div className="card-head">
        <div>
          {featured && <div className="eyebrow">Featured demo launch</div>}
          <strong className={featured ? "big-name" : ""}>{b.tokenName}</strong> <span className="muted">${b.tokenSymbol}</span>
        </div>
        {stage && <span className={`pill pill-${stage}`}>{STAGE_LABEL[stage]}</span>}
      </div>
      <Progress batch={b} compact={!featured} />
      <div className="meta">
        <span>{sol(b.totalQuote)} / {sol(b.maxPoolQuoteIn)} SOL</span>
        <span>{b.participantsCount} {b.participantsCount === 1 ? "wallet" : "wallets"}</span>
        {b.phase === "settled" && <span>{tokens(b.baseReceived, 0)} {b.tokenSymbol} bought in the opening batch</span>}
        {next && now && <span>{stage === "deposits" ? "closes" : "expires"} in {duration(next - now)}</span>}
        {publicKey?.equals(b.creator) && <span className="tag">yours</span>}
      </div>
      {featured && <span className="button primary fit">Open the demo →</span>}
    </a>
  );
}

export function LaunchList() {
  const program = useProgram();
  const now = useChainTime();
  const [batches, setBatches] = useState<Batch[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAllBatches(program).then(setBatches, (e) => setError(String(e?.message ?? e)));
  }, [program]);

  const featured = batches?.find((b) => b.address.toBase58() === FEATURED_BATCH);
  const others = batches?.filter((b) => b !== featured) ?? [];

  return (
    <>
      <section className="hero">
        <h1>Everyone gets the first price.</h1>
        <p>
          EqualStart pools SOL from many wallets into the <strong>very first buy</strong> of a new Meteora bonding-curve
          token. Pool creation and that buy happen in a single on-chain instruction, so nobody can trade before the batch,
          and every participant gets the same price per SOL. Any wallet can trigger settlement, so the launch never depends
          on the creator. If it isn't settled in time, everyone gets a full refund.
        </p>
        <div className="row">
          {featured && <a className="button primary" href={`#/launch/${featured.address.toBase58()}`}>See the live demo launch</a>}
          <button className="button" onClick={() => document.getElementById("how")?.scrollIntoView({ behavior: "smooth" })}>How it works</button>
        </div>
      </section>

      {error && <p className="error">Could not load launches: {error}</p>}
      {!batches && !error && <p className="muted">Loading launches from the chain…</p>}
      {featured && <LaunchCard b={featured} now={now} featured />}

      <Comparison />
      <HowItWorks />

      <section>
        <div className="section-head">
          <h2>All launches</h2>
          <a className="button" href="#/create">New launch</a>
        </div>
        {batches && others.length === 0 && <p className="muted">No other launches on this network yet.</p>}
        {others.length > 0 && (
          <details className="test-launches">
            <summary>
              {others.length} other {others.length === 1 ? "launch" : "launches"}, including automated test runs (refunds, rejected attacks, slippage)
            </summary>
            <div className="grid">
              {others.map((b) => <LaunchCard key={b.address.toBase58()} b={b} now={now} />)}
            </div>
          </details>
        )}
      </section>
    </>
  );
}
