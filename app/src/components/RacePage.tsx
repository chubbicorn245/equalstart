import comparison from "../lib/comparison.json" with { type: "json" };
import { Race } from "./Race.tsx";

/** Standalone, presentation-sized race (for screen recording): #/race. Press R or space to replay. */
export function RacePage() {
  return (
    <section className="card race-page">
      <p className="eyebrow">Measured on Meteora's bonding-curve program · 12 SOL from three buyers</p>
      <h1>Buying first vs. buying together</h1>
      <Race data={comparison.x20} autoplay="load" />
      <p className="muted small">{comparison.x20.source} Press R to replay.</p>
    </section>
  );
}
