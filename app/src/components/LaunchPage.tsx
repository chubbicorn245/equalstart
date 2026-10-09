import { useCallback, useEffect, useState } from "react";
import BN from "bn.js";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import type { PublicKey } from "@solana/web3.js";
import {
  cancelIxs,
  claimIxs,
  claimableShare,
  depositIxs,
  explorerAddress,
  explorerTx,
  fetchBatch,
  fetchContribution,
  fetchContributions,
  fetchActivity,
  findSettlementSignature,
  type Activity,
  type ContributionRow,
  minBaseOut,
  refundIxs,
  settleIxs,
  stageOf,
  withdrawIxs,
  type Batch,
  type Contribution,
} from "../lib/equalstart.ts";
import { CLUSTER, useChainTime, useProgram, useSend } from "../hooks.ts";
import { STAGE_LABEL, dateTime, duration, short, sol, solToLamports, tokens, TOKEN_DECIMALS } from "../format.ts";
import { Progress } from "./Progress.tsx";
import { TxNotice } from "./TxNotice.tsx";
import { ActivityFeed, Allocation, Timeline } from "./LaunchDetails.tsx";
import snapshot from "../lib/activity-snapshot.json" with { type: "json" };

const ACTIVITY_SNAPSHOT = snapshot as Record<string, { instruction: string; signer: string; error?: string }>;

export function LaunchPage({ address }: { address: PublicKey }) {
  const program = useProgram();
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const now = useChainTime();
  const [batch, setBatch] = useState<Batch | null | undefined>(undefined);
  const [mine, setMine] = useState<Contribution | null>(null);
  const [rows, setRows] = useState<ContributionRow[] | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(async () => {
    const b = await fetchBatch(program, address);
    setBatch(b);
    setMine(b && publicKey ? await fetchContribution(program, address, publicKey) : null);
    if (b) setRows(await fetchContributions(program, address).catch(() => null));
  }, [program, address, publicKey]);
  const afterTx = useCallback(async () => {
    await refresh();
    setVersion((v) => v + 1);
  }, [refresh]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 10_000);
    return () => clearInterval(t);
  }, [refresh]);

  const [activity, setActivity] = useState<Activity[] | null>(null);
  const [poolSettleSig, setPoolSettleSig] = useState<string | null>(null);
  useEffect(() => {
    fetchActivity(connection, address, ACTIVITY_SNAPSHOT).then(setActivity, () => setActivity([]));
  }, [connection, address, version]);
  useEffect(() => {
    if (batch?.phase === "settled") findSettlementSignature(connection, batch.pool).then(setPoolSettleSig, () => {});
  }, [connection, batch?.phase, batch?.pool]);
  const settleSig = activity?.find((a) => a.ok && a.instruction === "Settle")?.signature ?? poolSettleSig;

  const { state, send, reset } = useSend(afterTx);

  if (batch === undefined) return <p className="muted">Loading launch…</p>;
  if (batch === null) return <p className="error">No EqualStart launch at {address.toBase58()} on {CLUSTER}.</p>;

  const stage = now ? stageOf(batch, now) : null;
  const minMet = batch.totalQuote.gte(batch.minRaise);
  const countdown =
    stage === "deposits" ? { label: "Deposits close in", at: batch.closesAt } : stage === "settlement" ? { label: "Settlement window ends in", at: batch.expiresAt } : null;

  return (
    <div className="launch">
      <section className="launch-head">
        <div>
          <a href="#/" className="muted small">← All launches</a>
          <h1>
            {batch.tokenName} <span className="muted">${batch.tokenSymbol}</span>
          </h1>
        </div>
        {stage && <span className={`pill pill-${stage} big`}>{STAGE_LABEL[stage]}</span>}
      </section>

      <div className="columns">
        <div className="col-main">
          <section className="card">
            <Progress batch={batch} />
            <Timeline batch={batch} now={now} />
            <div className="stats">
              <Stat label="Participants" value={String(batch.participantsCount)} />
              <Stat label="Per-wallet cap" value={`${sol(batch.perWalletCap)} SOL`} />
              {countdown && now && <Stat label={countdown.label} value={duration(countdown.at - now)} />}
              {stage === "settled" && <Stat label="Claimed" value={`${batch.claimedCount} / ${batch.participantsCount}`} />}
            </div>
          </section>

          <TxNotice state={state} onDismiss={reset} />

          {stage === "settled" && <SettlementResult batch={batch} settleSig={settleSig} />}

          <section className="card">
            <h2>Your position</h2>
            {!publicKey ? (
              <div className="center">
                <p className="muted">Connect a wallet to deposit, claim or get a refund.</p>
                <WalletMultiButton />
              </div>
            ) : (
              <Position batch={batch} stage={stage} mine={mine} me={publicKey} send={send} pending={state.status === "pending"} minMet={minMet} />
            )}
          </section>
          <Allocation batch={batch} rows={rows} />
        </div>

        <aside className="col-side">
          <Commitments batch={batch} />
        </aside>
      </div>
      <div className="col-full">
        <ActivityFeed items={activity} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}

type SendFn = ReturnType<typeof useSend>["send"];

function Position({ batch, stage, mine, me, send, pending, minMet }: { batch: Batch; stage: ReturnType<typeof stageOf> | null; mine: Contribution | null; me: PublicKey; send: SendFn; pending: boolean; minMet: boolean }) {
  const program = useProgram();
  const [amount, setAmount] = useState("0.1");
  const deposited = mine?.amount ?? new BN(0);
  const room = BN.min(batch.perWalletCap.sub(deposited), batch.maxPoolQuoteIn.sub(batch.totalQuote));
  const lamports = solToLamports(amount);

  return (
    <div className="position">
      <p>
        Deposited: <strong>{sol(deposited)} SOL</strong>
        {!batch.totalQuote.isZero() && !deposited.isZero() && <span className="muted"> ({((Number(deposited.toString()) / Number(batch.totalQuote.toString())) * 100).toFixed(2)}% of the batch)</span>}
      </p>

      {stage === "deposits" && (
        <>
          <div className="row">
            <input className="amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" aria-label="Amount in SOL" />
            <span>SOL</span>
            <button
              className="button primary"
              disabled={pending || !lamports || lamports.isZero() || lamports.gt(room)}
              onClick={() => send("Deposit", () => depositIxs(program, batch, me, lamports!))}
            >
              Deposit
            </button>
            <button className="button" disabled={pending || !lamports || lamports.isZero() || lamports.gt(deposited)} onClick={() => send("Withdraw", () => withdrawIxs(program, batch, me, lamports!))}>
              Withdraw
            </button>
          </div>
          <p className="hint">
            You can add up to {sol(room)} SOL more. Withdrawals are allowed until deposits close. Your SOL is wrapped and held by
            the program, never by the creator.
          </p>
        </>
      )}

      {stage === "settlement" && (
        <div className="callout">
          {minMet ? (
            <>
              <p>
                Deposits are closed. <strong>Anyone</strong> can settle now: one transaction creates the pool and makes the batch
                buy before anyone else can trade. The settler receives the {sol(batch.settlerBounty)} SOL bounty (rent costs ≈0.022 SOL).
              </p>
              <button className="button primary" disabled={pending} onClick={() => send("Settle", () => settleIxs(program, batch, me))}>
                Settle launch
              </button>
            </>
          ) : (
            <p>The minimum raise was not met, so this batch cannot settle. After the settlement window ends, anyone can cancel it and every depositor gets a full refund.</p>
          )}
        </div>
      )}

      {stage === "expired" && (
        <div className="callout">
          <p>Nobody settled before the deadline. Anyone can cancel the launch to unlock full refunds; the unused bounty goes back to the creator.</p>
          <button className="button primary" disabled={pending} onClick={() => send("Cancel and enable refunds", () => cancelIxs(program, batch))}>
            Cancel and enable refunds
          </button>
        </div>
      )}

      {stage === "settled" && mine && !mine.amount.isZero() && (
        mine.claimed ? (
          <p className="ok">You claimed {tokens(claimableShare(batch, mine))} {batch.tokenSymbol}.</p>
        ) : (
          <div className="callout">
            <p>
              Your share: <strong>{tokens(claimableShare(batch, mine))} {batch.tokenSymbol}</strong>, calculated as tokens received × your deposit ÷ batch total, rounded down.
            </p>
            <button className="button primary" disabled={pending} onClick={() => send("Claim tokens", () => claimIxs(program, batch, me))}>
              Claim tokens
            </button>
          </div>
        )
      )}

      {stage === "cancelled" && mine && !mine.amount.isZero() && (
        mine.refunded ? (
          <p className="ok">Refunded {sol(mine.amount)} SOL.</p>
        ) : (
          <button className="button primary" disabled={pending} onClick={() => send("Refund", () => refundIxs(program, batch, me))}>
            Refund {sol(mine.amount)} SOL
          </button>
        )
      )}

      {(stage === "settled" || stage === "cancelled") && (!mine || mine.amount.isZero()) && <p className="muted">This wallet did not take part in the batch.</p>}
    </div>
  );
}

function SettlementResult({ batch, settleSig }: { batch: Batch; settleSig: string | null }) {
  const perSol = batch.quoteSpent.isZero() ? 0 : (Number(batch.baseReceived.toString()) / 10 ** TOKEN_DECIMALS) / (Number(batch.quoteSpent.toString()) / 1e9);
  return (
    <section className="card settled">
      <h2>Opening batch executed</h2>
      <p>
        The pool was created and the batch's {sol(batch.quoteSpent)} SOL was spent on its first buy, all in one transaction. Every
        participant paid the same average price.
      </p>
      <div className="stats">
        <Stat label="SOL spent" value={sol(batch.quoteSpent)} />
        <Stat label={`${batch.tokenSymbol} received`} value={tokens(batch.baseReceived, 0)} />
        <Stat label="Average price" value={`${perSol.toLocaleString(undefined, { maximumFractionDigits: 0 })} / SOL`} />
        <Stat label="Guaranteed minimum" value={`${tokens(minBaseOut(batch.totalQuote, batch.minBasePerSol), 0)}`} />
      </div>
      <p className="small">
        {settleSig ? (
          <a href={explorerTx(settleSig, CLUSTER)} target="_blank" rel="noreferrer">Settlement transaction</a>
        ) : (
          <span className="muted">Loading settlement transaction…</span>
        )}
        {" · "}
        <a href={explorerAddress(batch.pool, CLUSTER)} target="_blank" rel="noreferrer">Pool</a>
        {" · "}
        <a href={explorerAddress(batch.baseMint, CLUSTER)} target="_blank" rel="noreferrer">Token mint</a>
      </p>
    </section>
  );
}

function Commitments({ batch }: { batch: Batch }) {
  const link = (k: PublicKey) => (
    <a href={explorerAddress(k, CLUSTER)} target="_blank" rel="noreferrer"><code>{short(k)}</code></a>
  );
  return (
    <section className="card commitments">
      <h2>Immutable commitments</h2>
      <p className="muted small">Fixed at creation. Nobody, including the creator, can change them, and the creator cannot withdraw deposits.</p>
      <dl>
        <dt>Deposits close</dt><dd>{dateTime(batch.closesAt)}</dd>
        <dt>Settle by</dt><dd>{dateTime(batch.expiresAt)}</dd>
        <dt>Minimum raise</dt><dd>{sol(batch.minRaise)} SOL</dd>
        <dt>Batch cap</dt><dd>{sol(batch.maxPoolQuoteIn)} SOL</dd>
        <dt>Per-wallet cap</dt><dd>{sol(batch.perWalletCap)} SOL</dd>
        <dt>Opening fee ceiling</dt><dd>{(batch.maxOpeningFeeBps / 100).toFixed(2)}%</dd>
        <dt>Min. tokens per SOL</dt><dd>{tokens(batch.minBasePerSol, 0)}</dd>
        <dt>Settler bounty</dt><dd>{batch.phase === "open" ? `${sol(batch.settlerBounty)} SOL` : batch.phase === "settled" ? "paid to settler" : "returned to creator"}</dd>
        <dt>Creator</dt><dd>{link(batch.creator)}</dd>
        <dt>Escrow (batch)</dt><dd>{link(batch.address)}</dd>
        <dt>DBC config</dt><dd>{link(batch.dbcConfig)}</dd>
        <dt>Pool (reserved)</dt><dd>{link(batch.pool)}</dd>
        <dt>Token mint</dt><dd>{link(batch.baseMint)}</dd>
      </dl>
    </section>
  );
}
