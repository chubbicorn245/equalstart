/** The one-instruction settlement, drawn as nested CPI boxes. */
export function HowItWorks() {
  return (
    <section className="card how" aria-labelledby="how">
      <h2 id="how">How it works</h2>
      <ol className="steps">
        <li><span>1</span><div><strong>Commit</strong>: the creator fixes every term on-chain: deadlines, caps, minimum raise, fee ceiling, minimum price. None of it can change afterwards.</div></li>
        <li><span>2</span><div><strong>Deposit</strong>: participants move SOL into an escrow owned by the program. Nobody holds the keys to it, and the creator can't withdraw from it.</div></li>
        <li><span>3</span><div><strong>Settle</strong>: after the window closes, <em>any wallet</em> can trigger settlement. A single instruction creates the pool and makes the batch's buy.</div></li>
        <li><span>4</span><div><strong>Claim or refund</strong>: each participant claims tokens in proportion to their deposit. If nobody settles before the deadline, everyone can take a full refund.</div></li>
      </ol>

      <div className="diagram" role="img" aria-label="Settlement transaction: EqualStart settle calls Meteora DBC to create the pool, swap the whole batch, and hand over the creator role">
        <div className="d-box d-outer">
          <div className="d-title">One transaction · signed only by the settler (any wallet)</div>
          <div className="d-box d-es">
            <div className="d-title">EqualStart <code>settle</code></div>
            <div className="d-row">
              <div className="d-box d-dbc"><div className="d-step">1</div>Meteora DBC<br /><strong>create pool</strong><span>mint &amp; creator are EqualStart PDAs: nobody else can create this pool</span></div>
              <div className="d-arrow" aria-hidden>→</div>
              <div className="d-box d-dbc"><div className="d-step">2</div>Meteora DBC<br /><strong>swap whole batch</strong><span>the pool's first trade; minimum output scales with the total</span></div>
              <div className="d-arrow" aria-hidden>→</div>
              <div className="d-box d-dbc"><div className="d-step">3</div>Meteora DBC<br /><strong>hand creator role</strong><span>to the committed creator</span></div>
            </div>
            <div className="d-foot">Checks: committed config · fee ≤ ceiling · exact SOL spent · tokens ≥ minimum · settler receives bounty</div>
          </div>
        </div>
      </div>
    </section>
  );
}
