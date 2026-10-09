import { useCallback, useEffect, useMemo, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { Keypair, SendTransactionError, TransactionMessage, VersionedTransaction, type TransactionInstruction } from "@solana/web3.js";
import { makeProgram } from "./lib/equalstart.ts";
import idl from "./lib/equalstart.idl.json" with { type: "json" };

export const CLUSTER: string = import.meta.env.VITE_CLUSTER ?? "devnet";
export const RPC_URL: string = import.meta.env.VITE_RPC_URL ?? (CLUSTER === "localnet" ? "http://127.0.0.1:8899" : "https://api.devnet.solana.com");

/** The launch featured on the home page (the real-wallet demo); other launches are listed separately. */
export const FEATURED_BATCH: string = import.meta.env.VITE_FEATURED_BATCH ?? "8F8fx1WzLjdcXr1xYnp6BeC3o67zSKsgM8LPoknBaGQH";

export function useProgram() {
  const { connection } = useConnection();
  return useMemo(() => makeProgram(connection), [connection]);
}

/** Chain clock (not the browser clock), refreshed every 15s and ticked locally in between. */
export function useChainTime() {
  const { connection } = useConnection();
  const [base, setBase] = useState<{ chain: number; local: number } | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      try {
        const t = await connection.getBlockTime(await connection.getSlot("confirmed"));
        if (live && t) setBase({ chain: t, local: Date.now() / 1000 });
      } catch {
        /* keep last value */
      }
    };
    refresh();
    const r = setInterval(refresh, 15_000);
    const t = setInterval(() => setTick((x) => x + 1), 1_000);
    return () => {
      live = false;
      clearInterval(r);
      clearInterval(t);
    };
  }, [connection]);
  return base ? Math.floor(base.chain + (Date.now() / 1000 - base.local)) : null;
}

const ERRORS: Record<number, string> = Object.fromEntries((idl as any).errors.map((e: any) => [e.code, e.msg ?? e.name]));

function explain(err: unknown, logs?: string[] | null): string {
  const text = [String((err as any)?.message ?? err), ...(logs ?? [])].join("\n");
  const custom = text.match(/custom program error: 0x([0-9a-f]+)/i);
  if (custom) {
    const code = parseInt(custom[1], 16);
    if (ERRORS[code]) return ERRORS[code];
    if (code === 0x1772 && /dbcij3LW/.test(text)) return "DBC rejected the swap: output below the committed minimum price";
  }
  const anchorMsg = text.match(/Error Message: ([^\n.]+)/);
  if (anchorMsg) return anchorMsg[1];
  if (/User rejected/i.test(text)) return "Transaction was rejected in the wallet";
  if (/insufficient (lamports|funds)/i.test(text)) return "Not enough SOL in this wallet";
  return text.split("\n")[0].slice(0, 200);
}

export type TxState = { status: "idle" } | { status: "pending"; label: string } | { status: "done"; label: string; sig: string } | { status: "error"; label: string; message: string };

/** Sends instructions with the connected wallet, simulating first so failures show a readable reason. */
export function useSend(onDone?: () => void) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const [state, setState] = useState<TxState>({ status: "idle" });

  const send = useCallback(
    async (label: string, build: () => Promise<TransactionInstruction[]>, extraSigners: Keypair[] = []) => {
      if (!publicKey) return null;
      setState({ status: "pending", label });
      try {
        const ixs = await build();
        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
        const tx = new VersionedTransaction(new TransactionMessage({ payerKey: publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
        const sim = await connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false });
        if (sim.value.err) throw Object.assign(new Error(JSON.stringify(sim.value.err)), { logs: sim.value.logs });
        const sig = await sendTransaction(tx, connection, { signers: extraSigners });
        const res = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        if (res.value.err) throw new Error(JSON.stringify(res.value.err));
        setState({ status: "done", label, sig });
        onDone?.();
        return sig;
      } catch (e: any) {
        const logs = e?.logs ?? (e instanceof SendTransactionError ? await e.getLogs(connection).catch(() => null) : null);
        setState({ status: "error", label, message: explain(e, logs) });
        return null;
      }
    },
    [connection, publicKey, sendTransaction, onDone],
  );
  return { state, send, reset: () => setState({ status: "idle" }) };
}

export function useRoute() {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");
  useEffect(() => {
    const on = () => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return hash;
}
