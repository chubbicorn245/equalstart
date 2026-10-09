import { useState } from "react";
import BN from "bn.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { claimableShare, explorerAddress, explorerTx, type Activity, type Batch, type ContributionRow } from "../lib/equalstart.ts";
import { CLUSTER } from "../hooks.ts";
import { dateTime, duration, short, sol, tokens } from "../format.ts";

const COLORS = ["#2f8f62", "#d9822b", "#3f6fd8", "#b5487c", "#7a5cc9", "#2a9fa8", "#a8902a", "#c4523e"];

/** Deposits close → settlement window → expiry, with a marker for the chain clock. */
export function Timeline({ batch, now }: { batch: Batch; now: number | null }) {
  // The batch doesn't record its creation time, so the bar starts one deposit-window length before close.
  const span = batch.expiresAt - batch.closesAt;
  const start = batch.closesAt - Math.max(span / 2, 60);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - start) / (batch.expiresAt - start)) * 100));
  const done = batch.phase !== "open";
  return (
    <div className="timeline" aria-label="Launch timeline">
      <div className="tl-track">
        <div className="tl-seg tl-deposit" style={{ width: `${pct(batch.closesAt)}%` }} />
        <div className="tl-seg tl-settle" style={{ left: `${pct(batch.closesAt)}%`, width: `${100 - pct(batch.closesAt)}%` }} />
        {now && !done && <div className="tl-now" style={{ left: `${pct(now)}%` }} title="now (chain time)" />}
      </div>
      <div className="tl-labels">
        <span><strong>Deposits</strong> until {dateTime(batch.closesAt)}</span>
        <span><strong>Anyone can settle</strong> until {dateTime(batch.expiresAt)}</span>
        <span><strong>After that</strong> refunds</span>
      </div>
      {now && !done && now < batch.closesAt && <p className="small muted">Deposits close in {duration(batch.closesAt - now)} (chain time).</p>}
    </div>
  );
}

/** Each participant's slice of the batch, with the tokens that slice buys. */
export function Allocation({ batch, rows }: { batch: Batch; rows: ContributionRow[] | null }) {
  const { publicKey } = useWallet();
  if (!rows) return <section className="card"><h2>Allocation</h2><p className="muted">Loading participants…</p></section>;
  if (!rows.length) return <section className="card"><h2>Allocation</h2><p className="muted">No deposits yet.</p></section>;
  const total = batch.totalQuote.isZero() ? new BN(1) : batch.totalQuote;
  const share = (r: ContributionRow) => (Number(r.amount.toString()) / Number(total.toString())) * 100;
  const settled = batch.phase === "settled";
  return (
    <section className="card allocation" aria-labelledby="alloc">
      <h2 id="alloc">Allocation</h2>
      <p className="muted small">
        {settled
          ? `The batch bought ${tokens(batch.baseReceived, 0)} ${batch.tokenSymbol}. Each wallet's share of the tokens equals its share of the SOL, so everyone paid the same price.`
          : "Each wallet's share of the tokens will equal its share of the SOL in the batch, so everyone pays the same price."}
      </p>
      <div className="stack" role="img" aria-label="Share of the batch by wallet">
        {rows.map((r, i) => (
          <div key={r.address.toBase58()} className="stack-seg" style={{ width: `${share(r)}%`, background: COLORS[i % COLORS.length] }} title={`${short(r.participant)}: ${share(r).toFixed(2)}%`} />
        ))}
      </div>
      <table className="alloc-table">
        <thead>
          <tr><th>Wallet</th><th>Deposit</th><th>Share</th><th>{settled ? batch.tokenSymbol : `${batch.tokenSymbol} (at settlement)`}</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.address.toBase58()} className={publicKey?.equals(r.participant) ? "me" : ""}>
              <td><span className="swatch" style={{ background: COLORS[i % COLORS.length] }} /><a href={explorerAddress(r.participant, CLUSTER)} target="_blank" rel="noreferrer"><code>{short(r.participant)}</code></a>{publicKey?.equals(r.participant) && <span className="tag">you</span>}</td>
              <td>{sol(r.amount)} SOL</td>
              <td>{share(r).toFixed(2)}%</td>
              <td>{settled ? tokens(claimableShare(batch, r), 0) : "pro rata"}</td>
              <td className="muted small">{r.claimed ? "claimed" : r.refunded ? "refunded" : settled ? "unclaimed" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {settled && <p className="small muted">Tokens = floor({tokens(batch.baseReceived, 0)} × deposit ÷ {sol(batch.totalQuote)} SOL). Rounding dust (a few raw units) is burned once everyone has claimed.</p>}
    </section>
  );
}

const LABEL: Record<string, string> = {
  InitializeBatch: "Launch created",
  Deposit: "Deposit",
  Withdraw: "Withdrawal",
  Settle: "Settlement: pool created + batch buy",
  Claim: "Claim",
  CancelExpired: "Cancelled after expiry",
  Refund: "Refund",
  BurnDust: "Rounding dust burned",
};

/** Every transaction that touched the batch, with Solana Explorer links. */
export function ActivityFeed({ items }: { items: Activity[] | null }) {
  const [showFailed, setShowFailed] = useState(false);
  const failed = items?.filter((a) => !a.ok).length ?? 0;
  const shown = items?.filter((a) => showFailed || a.ok) ?? [];
  return (
    <section className="card" aria-labelledby="activity">
      <div className="section-head">
        <h2 id="activity">On-chain activity</h2>
        {failed > 0 && (
          <label className="small toggle">
            <input type="checkbox" checked={showFailed} onChange={(e) => setShowFailed(e.target.checked)} /> show {failed} rejected {failed === 1 ? "attempt" : "attempts"}
          </label>
        )}
      </div>
      {!items && <p className="muted">Loading transactions…</p>}
      {items && !shown.length && <p className="muted">No transactions found.</p>}
      <ul className="activity">
        {shown.map((a) => (
          <li key={a.signature} className={a.ok ? "" : "rejected"}>
            <span className="act-name">
              {a.instruction === "Unknown" ? (a.ok ? "Transaction" : "Rejected transaction") : a.ok ? LABEL[a.instruction] ?? a.instruction : `Rejected: ${LABEL[a.instruction] ?? a.instruction}`}
              {a.error && a.error !== "failed" && <code className="act-err">{a.error}</code>}
            </span>
            <span className="muted small">{a.signer ? `by ${short(a.signer)}` : ""}{a.time ? ` · ${dateTime(a.time)}` : ""}</span>
            <a href={explorerTx(a.signature, CLUSTER)} target="_blank" rel="noreferrer" className="small">Explorer ↗</a>
          </li>
        ))}
      </ul>
    </section>
  );
}
