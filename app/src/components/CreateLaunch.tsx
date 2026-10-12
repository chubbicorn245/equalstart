import { useEffect, useMemo, useState } from "react";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { NATIVE_MINT } from "@solana/spl-token";
import { Keypair, PublicKey } from "@solana/web3.js";
import { batchAddress, initializeBatchIxs, readDbcConfig, type LaunchTerms } from "../lib/equalstart.ts";
import { createDbcConfigIxs, DEFAULT_CURVE } from "../lib/dbcConfig.ts";
import { useChainTime, useProgram, useSend } from "../hooks.ts";
import { sol, solToLamports, TOKEN_DECIMALS } from "../format.ts";
import { TxNotice } from "./TxNotice.tsx";

type DbcInfo = Awaited<ReturnType<typeof readDbcConfig>>;

const MAX_SETTLE_MINUTES = 7 * 24 * 60;

function parsePubkey(s: string): PublicKey | null {
  try {
    return new PublicKey(s.trim());
  } catch {
    return null;
  }
}

export function CreateLaunch() {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const program = useProgram();
  const now = useChainTime();
  const { state, send, reset } = useSend();

  const [f, setF] = useState({
    name: "",
    symbol: "",
    uri: "",
    config: "",
    depositMinutes: "10",
    settleMinutes: "60",
    perWalletCap: "0.5",
    minRaise: "0.1",
    maxRaise: "2",
    maxFeeBps: "100",
    minTokensPerSol: "10000000",
    bounty: "0.03",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const configKey = parsePubkey(f.config);
  const [dbc, setDbc] = useState<DbcInfo | "missing" | null>(null);
  useEffect(() => {
    setDbc(null);
    if (!configKey) return;
    readDbcConfig(connection, configKey).then((c) => setDbc(c ?? "missing"), () => setDbc("missing"));
  }, [connection, f.config]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirrors the checks `initialize_batch` enforces, so problems show before signing.
  const problems = useMemo(() => {
    const p: string[] = [];
    const cap = solToLamports(f.perWalletCap), min = solToLamports(f.minRaise), max = solToLamports(f.maxRaise), bounty = solToLamports(f.bounty);
    if (!f.name.trim() || f.name.length > 32) p.push("Token name is required (max 32 characters).");
    if (!f.symbol.trim() || f.symbol.length > 10) p.push("Symbol is required (max 10 characters).");
    if (f.uri.length > 200) p.push("Metadata URI is at most 200 characters.");
    if (!configKey) p.push("Enter a DBC config address or create one.");
    else if (dbc === "missing") p.push("That address is not a Meteora DBC config on this network.");
    else if (dbc) {
      if (!dbc.quoteMint.equals(NATIVE_MINT)) p.push("DBC config must use wSOL as the quote token.");
      if (dbc.tokenType !== 0) p.push("DBC config must create an SPL token.");
      if (dbc.baseFeeMode === 2) p.push("DBC rate-limiter fee mode is not supported.");
      if (dbc.firstSwapMinFee) p.push("DBC config has first-swap-min-fee enabled; it only applies to non-CPI buys.");
      if (Number(f.maxFeeBps) < dbc.cliffFeeBps) p.push(`Fee ceiling must be at least the config's opening fee (${dbc.cliffFeeBps} bps).`);
      if (max && max.gte(dbc.migrationQuoteThreshold)) p.push(`Cap must be below the curve's graduation threshold (${sol(dbc.migrationQuoteThreshold)} SOL).`);
    }
    if (!(Number(f.depositMinutes) > 0)) p.push("Deposit window must be positive.");
    if (!(Number(f.settleMinutes) > 0)) p.push("Settlement window must be positive.");
    // The program doesn't bound this yet; a long window locks deposits if the launch can't settle.
    else if (Number(f.settleMinutes) > MAX_SETTLE_MINUTES) p.push("Settlement window is at most 7 days: if the launch can't settle, deposits stay locked until it ends.");
    if (!cap || cap.isZero()) p.push("Per-wallet cap must be positive.");
    if (!min || min.isZero()) p.push("Minimum raise must be positive.");
    if (!max || (min && max.lt(min))) p.push("Cap must be at least the minimum raise.");
    if (!bounty) p.push("Settler bounty must be a SOL amount (0 allowed).");
    const fee = Number(f.maxFeeBps);
    if (!Number.isInteger(fee) || fee < 0 || fee >= 10_000) p.push("Fee ceiling is in basis points (0–9999).");
    if (!/^\d+(\.\d{1,6})?$/.test(f.minTokensPerSol) || Number(f.minTokensPerSol) <= 0) p.push("Minimum tokens per SOL must be positive.");
    return p;
  }, [f, configKey, dbc]);

  return (
    <section className="narrow">
      <h1>New launch</h1>
      <p className="muted">
        Everything on this page becomes an immutable on-chain commitment. After you submit, nobody can change these terms,
        including you. Your part ends here: anyone can settle, and participants can always get refunds after expiry.
      </p>
      {!publicKey && (
        <div className="card center">
          <p>Connect a wallet to create a launch.</p>
          <WalletMultiButton />
        </div>
      )}
      {publicKey && (
        <form
          className="card form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (problems.length || !now || !configKey) return;
            const closesAt = now + Math.round(Number(f.depositMinutes) * 60);
            const terms: LaunchTerms = {
              launchId: new BN(Date.now()),
              closesAt,
              expiresAt: closesAt + Math.round(Number(f.settleMinutes) * 60),
              perWalletCap: solToLamports(f.perWalletCap)!,
              minRaise: solToLamports(f.minRaise)!,
              maxPoolQuoteIn: solToLamports(f.maxRaise)!,
              minBasePerSol: new BN(Math.round(Number(f.minTokensPerSol) * 10 ** TOKEN_DECIMALS).toString()),
              maxOpeningFeeBps: Number(f.maxFeeBps),
              settlerBounty: solToLamports(f.bounty)!,
              tokenName: f.name.trim(),
              tokenSymbol: f.symbol.trim(),
              tokenUri: f.uri.trim(),
            };
            const sig = await send("Create launch", async () => (await initializeBatchIxs(program, publicKey, configKey, terms)).ixs);
            if (sig) window.location.hash = `#/launch/${batchAddress(publicKey, terms.launchId).toBase58()}`;
          }}
        >
          <fieldset>
            <legend>Token</legend>
            <label>Name<input value={f.name} onChange={set("name")} maxLength={32} placeholder="Equal Token" /></label>
            <label>Symbol<input value={f.symbol} onChange={set("symbol")} maxLength={10} placeholder="EQL" /></label>
            <label className="wide">Metadata URI <span className="muted">(optional)</span><input value={f.uri} onChange={set("uri")} maxLength={200} placeholder="https://…/metadata.json" /></label>
          </fieldset>

          <fieldset>
            <legend>Bonding curve (Meteora DBC config)</legend>
            <label className="wide">
              Config address
              <input value={f.config} onChange={set("config")} placeholder="DBC config public key" spellCheck={false} />
            </label>
            <div className="wide row">
              <ConfigCreator onCreated={(k) => setF((x) => ({ ...x, config: k.toBase58() }))} />
              <span className="muted small">
                Default: flat {DEFAULT_CURVE.feeBps / 100}% fee, {DEFAULT_CURVE.initialMarketCapSol}→{DEFAULT_CURVE.migrationMarketCapSol} SOL market cap, graduates to DAMM v2.
              </span>
            </div>
            {dbc && dbc !== "missing" && (
              <p className="wide small">
                Opening fee {dbc.cliffFeeBps} bps · graduates at {sol(dbc.migrationQuoteThreshold)} SOL · pool creation fee {sol(dbc.poolCreationFee)} SOL
              </p>
            )}
          </fieldset>

          <fieldset>
            <legend>Batch terms</legend>
            <label>Deposit window (minutes)<input value={f.depositMinutes} onChange={set("depositMinutes")} inputMode="decimal" /></label>
            <label>
              Settlement window (minutes)
              <input value={f.settleMinutes} onChange={set("settleMinutes")} inputMode="decimal" />
              <span className="hint">Max 7 days. If the launch can't settle, deposits are refundable only after this window ends.</span>
            </label>
            <label>Per-wallet cap (SOL)<input value={f.perWalletCap} onChange={set("perWalletCap")} inputMode="decimal" /></label>
            <label>Minimum raise (SOL)<input value={f.minRaise} onChange={set("minRaise")} inputMode="decimal" /></label>
            <label>Batch cap (SOL)<input value={f.maxRaise} onChange={set("maxRaise")} inputMode="decimal" /></label>
            <label>Opening fee ceiling (bps)<input value={f.maxFeeBps} onChange={set("maxFeeBps")} inputMode="numeric" /></label>
            <label>
              Minimum tokens per SOL
              <input value={f.minTokensPerSol} onChange={set("minTokensPerSol")} inputMode="decimal" />
              <span className="hint">Worst average price you accept. The default curve gives ≈32M per SOL for a 0.6 SOL batch.</span>
            </label>
            <label>
              Settler bounty (SOL)
              <input value={f.bounty} onChange={set("bounty")} inputMode="decimal" />
              <span className="hint">Escrowed now. Paid to whoever settles; returned to you if nobody does. Settling costs ≈0.022 SOL in rent.</span>
            </label>
          </fieldset>

          {problems.length > 0 && (
            <ul className="problems">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}
          <TxNotice state={state} onDismiss={reset} />
          <button className="button primary" disabled={problems.length > 0 || !now || state.status === "pending"}>
            Commit launch terms
          </button>
        </form>
      )}
    </section>
  );
}

/** Creates the default DBC config; the new config keypair co-signs with the wallet. */
function ConfigCreator({ onCreated }: { onCreated: (k: PublicKey) => void }) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [pending, setPending] = useState<Keypair | null>(null);
  const { state, send, reset } = useSend();

  async function prepare() {
    if (!publicKey) return;
    const r = await createDbcConfigIxs(connection, publicKey);
    setPending(r.config);
    const sig = await send("Create DBC config", async () => r.ixs, [r.config]);
    if (sig) onCreated(r.config.publicKey);
    setPending(null);
  }

  return (
    <>
      <button type="button" className="button" onClick={prepare} disabled={!!pending || state.status === "pending"}>
        Create default config
      </button>
      <TxNotice state={state} onDismiss={reset} />
    </>
  );
}
