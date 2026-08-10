import { useState, type CSSProperties } from "react";
import { circleErrorLabel } from "../lib/circleModular";
import { useCircleModularWallet } from "../lib/circleModularWallet";

function shortHex(value: string) { return value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value; }

export function CirclePasskeyButton({ style }: { style?: CSSProperties }) {
  const { config, status, error, busy, wallet, register, login, disconnect } = useCircleModularWallet();
  const [menuOpen, setMenuOpen] = useState(false);
  const [username, setUsername] = useState("");

  if (config.id === "missing-config") return <button type="button" className="or-circle-trigger" disabled title={config.reason} style={style}><i /><span>CIRCLE UNAVAILABLE</span></button>;

  const statusError = status === "user-rejected" || status === "sponsorship-denied" || status === "rpc-failure" || status === "transaction-reverted" || status === "receipt-verification-failure" || status === "insufficient-balance" ? circleErrorLabel(status) : "";

  return <div className="or-circle-control" style={style}><button type="button" className={`or-circle-trigger ${wallet ? "connected" : ""}`} data-testid="circle-passkey-button" disabled={busy} onClick={() => setMenuOpen((open) => !open)} title={wallet?.address ?? "Circle Modular Wallet"}><i /><span>{busy ? "PASSKEY..." : wallet ? `CIRCLE ${shortHex(wallet.address)}` : "CIRCLE PASSKEY"}</span></button>{menuOpen && <section className="or-circle-menu"><header><span>CIRCLE / MODULAR WALLET</span><strong>{wallet ? "PASSKEY CONNECTED" : "CREATE OR UNLOCK"}</strong></header>{wallet ? <><code>{shortHex(wallet.address)}</code><button type="button" onClick={() => { disconnect(); setMenuOpen(false); }}>DISCONNECT PASSKEY</button></> : <><label><span>PASSKEY NAME</span><input data-testid="circle-passkey-name" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Device or account label" disabled={busy} /></label><div><button type="button" data-testid="circle-create-passkey" disabled={busy || !username.trim()} onClick={() => register(username)}>CREATE PASSKEY</button><button type="button" data-testid="circle-login-passkey" disabled={busy} onClick={() => login()}>LOG IN</button></div></>}{(error || statusError) && <p>{error || statusError}</p>}</section>}</div>;
}
