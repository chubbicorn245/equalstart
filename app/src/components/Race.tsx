import { useCallback, useEffect, useRef, useState } from "react";
import comparison from "../lib/comparison.json" with { type: "json" };

type Data = (typeof comparison)["x20"];

// Chart geometry (SVG user units; the SVG scales to its container).
const W = 720, H = 320, L = 56, R = 16, T = 40, B = 44;
const fmt = (n: number) => `${(n / 1e6).toFixed(1)}M`;

// Step at which each frame starts, in ms after play.
const SCHEDULE = [0, 500, 1900, 3300, 4700, 7400, 8800];
const LAST = SCHEDULE.length - 1;

/**
 * Animated version of the comparison: three buyers walk up the curve one after another, then the same SOL lands as
 * one EqualStart batch at a single price. Bar height is tokens received per SOL, from the measured DBC numbers.
 */
export function Race({ data, autoplay = "visible" }: { data: Data; autoplay?: "visible" | "load" }) {
  const [step, setStep] = useState(0);
  const timers = useRef<number[]>([]);
  const root = useRef<HTMLDivElement>(null);

  const play = useCallback(() => {
    timers.current.forEach(clearTimeout);
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return setStep(LAST);
    setStep(0);
    timers.current = SCHEDULE.slice(1).map((ms, i) => window.setTimeout(() => setStep(i + 1), ms));
  }, []);

  useEffect(() => {
    if (autoplay === "load") {
      const t = window.setTimeout(play, 800);
      return () => clearTimeout(t);
    }
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return play();
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        play();
        io.disconnect();
      }
    }, { threshold: 0.6 });
    io.observe(el);
    return () => io.disconnect();
  }, [autoplay, play]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // Replay with R or space on the standalone page.
  useEffect(() => {
    if (autoplay !== "load") return;
    const on = (e: KeyboardEvent) => {
      if (e.key === "r" || e.key === " ") {
        e.preventDefault();
        play();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [autoplay, play]);

  const seq = data.sequential, batch = data.batch;
  const totalSol = seq.reduce((a, s) => a + s.sol, 0);
  const top = Math.max(...seq.map((s) => s.tokensPerSol), ...batch.map((b) => b.tokensPerSol)) * 1.12;
  const x = (sol: number) => L + (sol / totalSol) * (W - L - R);
  const y = (tps: number) => H - B - (tps / top) * (H - T - B);
  const base = H - B;
  const gap = ((seq[0].tokensPerSol / seq[seq.length - 1].tokensPerSol - 1) * 100).toFixed(0);
  const batchTps = batch[0].tokensPerSol;

  const bars = (rows: { name: string; sol: number; tokensPerSol: number }[]) => {
    let at = 0;
    return rows.map((r) => {
      const x0 = x(at), x1 = x((at += r.sol));
      return { ...r, x0: x0 + 2, w: x1 - x0 - 4, top: y(r.tokensPerSol) };
    });
  };
  const seqBars = bars(seq), batchBars = bars(batch);
  const batchPhase = step >= 5;

  const captions = [
    "Three people buy a brand-new token on a bonding curve, one after another.",
    `${seq[0].name} is first in line: ${fmt(seq[0].tokensPerSol)} tokens for every SOL.`,
    `${seq[1].name}'s buy starts where ${seq[0].name}'s ended, so each SOL gets fewer tokens.`,
    `${seq[2].name}, last in line, gets the fewest: ${fmt(seq[2].tokensPerSol)} per SOL.`,
    `Going first was worth ${gap}% more tokens per SOL. On a real launch, first in line is usually a bot.`,
    "With EqualStart, all three deposits go in as one single first buy.",
    `One price for everyone: ${fmt(batchTps)} tokens per SOL each. Nobody went first.`,
  ];

  return (
    <div className={`race ${batchPhase ? "race-batch" : ""}`} ref={root}>
      <div className="race-head">
        <span className={`race-mode ${batchPhase ? "eq" : "seq"}`}>{batchPhase ? "EqualStart batch" : "Buying in order"}</span>
        <button className="button race-replay" onClick={play} aria-label="Replay the animation">↻ Replay</button>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Buying in order: ${seq.map((s) => `${s.name} ${fmt(s.tokensPerSol)}`).join(", ")} tokens per SOL. EqualStart batch: ${fmt(batchTps)} each.`}>
        <line className="race-axis" x1={L} y1={base} x2={W - R} y2={base} />
        <line className="race-axis" x1={L} y1={T - 10} x2={L} y2={base} />
        <text className="race-axis-label" x={L - 8} y={T - 18} textAnchor="start">tokens per SOL ↑</text>
        <text className="race-axis-label" x={W - R} y={H - 12} textAnchor="end">SOL spent →</text>

        {seqBars.map((b, i) => {
          const shown = step >= i + 1;
          return (
            <g key={`s${b.name}`} className={`race-g ${shown ? "in" : ""} ${batchPhase ? "ghost" : ""}`}>
              <rect className="race-bar seq" x={b.x0} y={b.top} width={b.w} height={base - b.top} rx={6} />
              <text className="race-value" x={b.x0 + b.w / 2} y={b.top - 10} textAnchor="middle">{fmt(b.tokensPerSol)}</text>
              <text className="race-name" x={b.x0 + b.w / 2} y={base + 20} textAnchor="middle">#{i + 1} {b.name} · {b.sol} SOL</text>
            </g>
          );
        })}

        {batchBars.map((b, i) => (
          <g key={`b${b.name}`} className={`race-g batch ${batchPhase ? "in" : ""} ${step >= 6 ? "split" : ""}`}>
            <rect className={`race-bar eq eq${i}`} x={b.x0} y={b.top} width={b.w} height={base - b.top} rx={6} />
            <text className="race-value eqv" x={b.x0 + b.w / 2} y={b.top - 10} textAnchor="middle">{fmt(b.tokensPerSol)}</text>
            <text className="race-inside" x={b.x0 + b.w / 2} y={base - 14} textAnchor="middle">{b.name}</text>
          </g>
        ))}
        <line className={`race-level ${step >= 6 ? "in" : ""}`} x1={L} x2={W - R} y1={y(batchTps)} y2={y(batchTps)} />
      </svg>
      <p className="race-caption" aria-live="polite">{captions[step]}</p>
    </div>
  );
}
