import { useEffect, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Link, NavLink } from "react-router-dom";
import { useSwitchChain } from "wagmi";
import { useWalletConnection } from "../../lib/useWalletConnection";

function NetworkControl() {
  const { login, ready } = usePrivy();
  const { address, isConnected, chainId } = useWalletConnection();
  const { switchChain } = useSwitchChain();
  const wrongNetwork = isConnected && chainId !== 5042002;

  function act() {
    if (!ready) return;
    if (wrongNetwork) {
      switchChain({ chainId: 5042002 });
      return;
    }
    if (!isConnected) login();
  }

  const label = !ready
    ? "LOADING"
    : wrongNetwork
      ? "SWITCH TO ARC"
      : address
        ? `${address.slice(0, 6)}…${address.slice(-4)}`
        : "CONNECT";

  return (
    <div className="network-control">
      <span><i /> ARC / TESTNET</span>
      <Link className="enter-app" to="/app">ENTER APP</Link>
      <button type="button" onClick={act} disabled={!ready || (isConnected && !wrongNetwork)}>{label}</button>
    </div>
  );
}

export function ProductShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 90);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="app-shell gasok-product">
      <header className={`control-strip ${compact ? "is-compact" : ""}`}>
        <Link className="brand" to="/" aria-label="OpenRails home"><img className="brand-mark" src="/assets/or-logo.jpg" alt="" /><span>OPENRAILS</span></Link>
        <nav aria-label="Primary navigation">
          <NavLink to="/system">SYSTEM</NavLink>
          <NavLink to="/network">NETWORK</NavLink>
          <NavLink to="/build">BUILD</NavLink>
          <NavLink to="/docs">DOCS</NavLink>
        </nav>
        <NetworkControl />
      </header>
      {children}
      {footer}
    </div>
  );
}
