import BN from "bn.js";
import type { Stage } from "./lib/equalstart.ts";

export const LAMPORTS = 1_000_000_000;
export const TOKEN_DECIMALS = 6;

export function sol(lamports: BN | number | bigint, digits = 4): string {
  const n = typeof lamports === "number" ? lamports : Number(lamports.toString());
  return (n / LAMPORTS).toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function tokens(raw: BN | bigint | string, digits = 2): string {
  const n = Number(raw.toString()) / 10 ** TOKEN_DECIMALS;
  return n.toLocaleString(undefined, { maximumFractionDigits: digits });
}

export function solToLamports(input: string): BN | null {
  const t = input.trim();
  if (!/^\d*(\.\d{0,9})?$/.test(t) || t === "" || t === ".") return null;
  const [whole, frac = ""] = t.split(".");
  return new BN(whole || "0").mul(new BN(LAMPORTS)).add(new BN((frac + "000000000").slice(0, 9)));
}

export function short(addr: { toString(): string }, n = 4): string {
  const s = addr.toString();
  return `${s.slice(0, n)}…${s.slice(-n)}`;
}

export function duration(seconds: number): string {
  if (seconds <= 0) return "0s";
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60), s = seconds % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export const dateTime = (unix: number) => new Date(unix * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

export const STAGE_LABEL: Record<Stage, string> = {
  deposits: "Deposits open",
  settlement: "Ready to settle",
  expired: "Expired",
  settled: "Settled",
  cancelled: "Refunding",
};
