import { useState } from "react";
import comparison from "../lib/comparison.json" with { type: "json" };
import { Race } from "./Race.tsx";

type Scenario = keyof typeof comparison;
const SCENARIOS: { key: Scenario; label: string }[] = [
  { key: "demo", label: "0.6 SOL batch (the demo)" },
  { key: "x20", label: "12 SOL batch (20×)" },
];

/** Sequential bonding-curve buys vs one EqualStart batch, from measurements on the real DBC program. */
export function Comparison() {
  const [key, setKey] = useState<Scenario>("x20");
  const data = comparison[key];
  const max = Math.max(...data.sequential.map((s) => s.tokensPerSol), ...data.batch.map((b) => b.tokensPerSol));
  const first = data.sequential[0], last = data.sequential[data.sequential.length - 1];
  const gap = ((first.tokensPerSol / last.tokensPerSol - 1) * 100).toFixed(0);
  const fmt = (n: number) => `${(n / 1e6).toFixed(1)}M`;

  return (
    <section className="card comparison" aria-labelledby="why">
      <div className="section-head">
        <h2 id="why">Why one batch beats buying in order</h2>
        <div className="segmented" role="tablist" aria-label="Batch size">
          {SCENARIOS.map((s) => (
            <button key={s.key} role="tab" aria-selected={key === s.key} className={key === s.key ? "on" : ""} onClick={() => setKey(s.key)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">
        On a bonding curve every buy raises the price for the next one. When Alice, Bob and Carol buy one after another,
        whoever lands first gets the best price, and in practice that's a bot. With EqualStart, their SOL becomes a single
        first buy and each person receives the same tokens per SOL.
      </p>

      <Race key={key} data={data} />

      <div className="compare-grid">
        <div>
          <h3>Sequential buys</h3>
          {data.sequential.map((s) => (
            <div className="hbar" key={s.name}>
              <span className="hbar-label">#{s.order} {s.name} <span className="muted">{s.sol} SOL</span></span>
              <div className="hbar-track"><div className="hbar-fill seq" style={{ width: `${(s.tokensPerSol / max) * 100}%` }} /></div>
              <span className="hbar-value">{fmt(s.tokensPerSol)} / SOL</span>
            </div>
          ))}
        </div>
        <div>
          <h3>EqualStart batch</h3>
          {data.batch.map((b) => (
            <div className="hbar" key={b.name}>
              <span className="hbar-label">{b.name} <span className="muted">{b.sol} SOL</span></span>
              <div className="hbar-track"><div className="hbar-fill eq" style={{ width: `${(b.tokensPerSol / max) * 100}%` }} /></div>
              <span className="hbar-value">{fmt(b.tokensPerSol)} / SOL</span>
            </div>
          ))}
        </div>
      </div>
      <p className="small">
        <strong>Buying in order, the first buyer gets {gap}% more tokens per SOL than the last.</strong> In the batch the
        spread is zero. The total number of tokens is the same either way; the batch only removes the advantage of
        going first.
      </p>
      <p className="muted small">{data.source}</p>
    </section>
  );
}
