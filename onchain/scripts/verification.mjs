// Builds VERIFICATION.md for judges from a public-cluster evidence file.
//   node scripts/verification.mjs ../evidence/devnet-run.json > ../VERIFICATION.md
import fs from "node:fs";
import { execSync } from "node:child_process";

const e = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const cluster = e.cluster;
const tx = (sig) => `[${sig.slice(0, 16)}…](https://explorer.solana.com/tx/${sig}?cluster=${cluster})`;
const addr = (a) => `[\`${a}\`](https://explorer.solana.com/address/${a}?cluster=${cluster})`;
const find = (re) => e.transactions.filter((t) => re.test(t.label));
const sh = (c) => { try { return execSync(c, { encoding: "utf8" }).trim(); } catch (err) { return `(failed: ${c})`; } };
const reason = (t) => t.ok ? "✅ succeeded" : `❌ rejected: ${(t.logs.join("\n").match(/Error Code: (\w+)/) || t.logs.join("\n").match(/(owner does not match|already in use|unauthorized signer|ExceededSlippage)/) || [, "?"])[1]}`;
const programId = e.versions.equalstartProgram;
const show = sh(`solana program show -u ${cluster} -k ../keys/deployer.json ${programId}`);
const localHash = sh(`shasum -a 256 target/deploy/equalstart.so | cut -d' ' -f1`);
const dumpPath = `${process.env.TMPDIR ?? "/tmp"}/equalstart-${cluster}-dump.so`;
sh(`solana program dump -u ${cluster} -k ../keys/deployer.json ${programId} ${dumpPath}`);
const deployedHash = sh(`shasum -a 256 ${dumpPath} | cut -d' ' -f1`);

const rows = (list) => list.map((t) => `| ${t.label} | ${reason(t)} | ${tx(t.signature)} |`).join("\n");
const s = e.settlement;
console.log(`# EqualStart: public ${cluster} verification record

Generated ${new Date().toISOString()} from \`evidence/${process.argv[2].split("/").pop()}\` (run ${e.startedAt} → ${e.finishedAt}).
Every link below opens the transaction or account on the public Solana Explorer.

## Deployment

| | |
|---|---|
| EqualStart program | ${addr(programId)} |
| Meteora DBC program (Meteora's live deployment) | ${addr("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN")} |
| Local build sha256 (\`onchain/target/deploy/equalstart.so\`) | \`${localHash}\` |
| Deployed program sha256 (\`solana program dump\`) | \`${deployedHash}\` ${deployedHash === localHash ? "(matches the local build)" : "(DOES NOT MATCH the local build)"} |
| DBC SDK / IDL / Anchor / validator | ${e.versions.dbcSdk} / ${e.versions.dbcIdl} / ${e.versions.anchorClient} / ${e.versions.solanaCore} |

\`\`\`
${show}
\`\`\`

The upgrade authority is a throwaway deployer key. See "Limitations".

## The opening batch: deposits → one-instruction settlement → independent claims

Batch (escrow) ${addr(e.mainBatch.batch)} · pool ${addr(e.mainBatch.pool)} · token mint ${addr(e.mainBatch.baseMint)}

${"| Step | Result | Transaction |\n|---|---|---|"}
${rows(find(/^(initialize_batch main|deposit .*\(main\)|withdraw .*\(main\)|SETTLEMENT|claim |burn_dust \()/))}

**What to check in the settlement transaction** ${tx(e.settlementSignature)}:
- The signer is \`eve\` (${addr(e.wallets.eve)}), a wallet with no role in the launch. The creator (${addr(e.wallets.creator)}) signs nothing after \`initialize_batch\`.
- EqualStart is the only top-level program. The DBC instructions \`InitializeVirtualPoolWithSplToken\`, \`Swap2\` and \`TransferPoolCreator\` all appear as inner instructions at depth 2.
- Log line: \`EqualStart settled: quote_spent=${s.batch.quoteSpent} base_received=${s.batch.baseReceived} min_base_out=${s.minBaseOut} opening_fee=${s.openingFee}\`.
- The pool's transaction history has no successful transaction before this one.

Claims (1:2:3 deposits): Alice ${e.balances.claims.alice} · Bob ${e.balances.claims.bob} · Carol ${e.balances.claims.carol} raw units. Each equals floor(${s.batch.baseReceived} × deposit ÷ ${s.batch.totalQuote}).

## Creator abandonment and refunds

${"| Step | Result | Transaction |\n|---|---|---|"}
${rows(find(/(abandoned|underfunded|refund|cancel)/))}

## Immutable commitments, invalid configs, attacks

Each of these was submitted on purpose and rejected on-chain. The failed transactions are visible on the explorer.

${"| Attempt | Result | Transaction |\n|---|---|---|"}
${rows(find(/^(ATTACK|GRIEF|settle slippage)/))}

## Reproduce

\`\`\`bash
git clone <repo> && cd equalstart_spike/onchain && npm install && anchor build
scripts/devnet.sh            # deploys and runs tests/equalstart.ts against live devnet DBC
\`\`\`
Full logs for every transaction: \`evidence/${process.argv[2].split("/").pop()}\`.

## Limitations (read before trusting this)

- **Unaudited.** This is a hackathon prototype. It needs an independent security review before any mainnet use.
- **Upgrade authority.** The deployer key can upgrade EqualStart on ${cluster}, which can change everything above. A trustless deployment needs the authority revoked, or held by a disclosed multisig with a timelock.
- **Dependency on Meteora DBC.** EqualStart hard-codes DBC's discriminators, account order and byte offsets from IDL 0.2.1. Meteora can upgrade DBC; a layout change could break or mislead these checks. During settlement, EqualStart lets the escrow's address sign for DBC calls; before/after balance checks limit, but cannot rule out, the damage from a malicious DBC upgrade.
- Further limitations are in \`ONCHAIN_RESULTS.md\` ("Remaining security concerns").
`);
