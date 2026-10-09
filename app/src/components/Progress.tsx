import type { Batch } from "../lib/equalstart.ts";
import { sol } from "../format.ts";

export function Progress({ batch, compact = false }: { batch: Batch; compact?: boolean }) {
  const max = Number(batch.maxPoolQuoteIn.toString());
  const pct = (x: number) => Math.min(100, (x / max) * 100);
  const raised = pct(Number(batch.totalQuote.toString()));
  const min = pct(Number(batch.minRaise.toString()));
  const met = batch.totalQuote.gte(batch.minRaise);
  return (
    <div className={compact ? "progress compact" : "progress"}>
      <div
        className="bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Number(batch.totalQuote.toString())}
        aria-label="SOL raised"
      >
        <div className={`fill ${met ? "met" : ""}`} style={{ width: `${raised}%` }} />
        <div className="marker" style={{ left: `${min}%` }} title={`Minimum raise ${sol(batch.minRaise)} SOL`} />
      </div>
      {!compact && (
        <div className="progress-legend">
          <span>
            <strong>{sol(batch.totalQuote)} SOL</strong> raised
          </span>
          <span className={met ? "ok" : "muted"}>{met ? "minimum met" : `minimum ${sol(batch.minRaise)} SOL`}</span>
          <span className="muted">cap {sol(batch.maxPoolQuoteIn)} SOL</span>
        </div>
      )}
    </div>
  );
}
