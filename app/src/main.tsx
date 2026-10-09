import { Buffer } from "buffer";
(globalThis as any).Buffer ??= Buffer;

const { createRoot } = await import("react-dom/client");
const { App } = await import("./App.tsx");
await import("@solana/wallet-adapter-react-ui/styles.css");
await import("./styles.css");

createRoot(document.getElementById("root")!).render(<App />);
