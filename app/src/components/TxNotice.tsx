import { CLUSTER, type TxState } from "../hooks.ts";
import { explorerTx } from "../lib/equalstart.ts";

export function TxNotice({ state, onDismiss }: { state: TxState; onDismiss: () => void }) {
  if (state.status === "idle") return null;
  return (
    <div className={`notice notice-${state.status}`} role="status">
      {state.status === "pending" && <span>{state.label}: waiting for wallet and confirmation…</span>}
      {state.status === "done" && (
        <span>
          {state.label} confirmed.{" "}
          <a href={explorerTx(state.sig, CLUSTER)} target="_blank" rel="noreferrer">
            View transaction
          </a>
        </span>
      )}
      {state.status === "error" && (
        <span>
          {state.label} failed: {state.message}
        </span>
      )}
      {state.status !== "pending" && (
        <button className="link" onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  );
}
