import { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { CLUSTER, RPC_URL, useRoute } from "./hooks.ts";
import { PROGRAM_ID, explorerAddress } from "./lib/equalstart.ts";
import { LaunchList } from "./components/LaunchList.tsx";
import { CreateLaunch } from "./components/CreateLaunch.tsx";
import { LaunchPage } from "./components/LaunchPage.tsx";

function Routes() {
  const route = useRoute();
  if (route === "/create") return <CreateLaunch />;
  const m = route.match(/^\/launch\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
  if (m) {
    try {
      return <LaunchPage address={new PublicKey(m[1])} />;
    } catch {
      /* fall through */
    }
  }
  return <LaunchList />;
}

export function App() {
  // Wallet Standard wallets (Phantom, Solflare, Backpack, …) are detected automatically.
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={RPC_URL} config={{ commitment: "confirmed" }}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          <header className="topbar">
            <a className="brand" href="#/">
              <span className="brand-mark" aria-hidden>=</span>
              EqualStart
            </a>
            <span className={`cluster cluster-${CLUSTER}`}>{CLUSTER}</span>
            <nav>
              <a href="#/">Launches</a>
              <a href="#/create">New launch</a>
            </nav>
            <WalletMultiButton />
          </header>
          <main>
            <Routes />
          </main>
          <footer className="footer">
            <p>
              Program <a href={explorerAddress(PROGRAM_ID, CLUSTER)} target="_blank" rel="noreferrer"><code>{PROGRAM_ID.toBase58()}</code></a> on {CLUSTER}.
              Unaudited hackathon prototype running on test networks only. Do not use with real funds.
            </p>
          </footer>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
