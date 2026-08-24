import { useEffect, useState, type ReactNode } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Menu, X } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { useSwitchChain } from "wagmi";
import { useWalletConnection } from "../../lib/useWalletConnection";

function NetworkControl({ inApp }: { inApp: boolean }) {
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
    <div className="network-control" data-tour-target="wallet-control">
      <span><i /> ARC / TESTNET</span>
      {!inApp && <Link className="enter-app" to="/app">ENTER APP</Link>}
      <button type="button" onClick={act} disabled={!ready || (isConnected && !wrongNetwork)}>{label}</button>
    </div>
  );
}

export function ProductShell({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  const { pathname } = useLocation();
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const inApp = pathname === "/app" || pathname.startsWith("/app/");

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 90);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [menuOpen]);

  return (
    <div className="app-shell gasok-product">
      <header className={`control-strip ${compact ? "is-compact" : ""} ${inApp ? "is-app-context" : ""}`}>
        <div className="app-brand-cluster">
          <Link className="brand" to="/" aria-label="OpenRails home"><img className="brand-mark" src="/assets/or-logo.jpg" alt="" /><span>OPENRAILS</span></Link>
        </div>
        {!inApp && <nav aria-label="Primary navigation">
          <NavLink to="/system">SYSTEM</NavLink>
          <NavLink to="/network">NETWORK</NavLink>
          <NavLink to="/build">BUILD</NavLink>
          <NavLink to="/docs">DOCS</NavLink>
        </nav>}
        <div className="app-header-actions">
          <NetworkControl inApp={inApp} />
          {inApp && <button className="app-menu-trigger" type="button" aria-label={menuOpen ? "Close product navigation" : "Open product navigation"} title={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="app-product-menu" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? <X size={17} /> : <Menu size={17} />}</button>}
        </div>
        {inApp && menuOpen && <nav className="app-product-menu" id="app-product-menu" aria-label="Product navigation">
          <NavLink to="/system" onClick={() => setMenuOpen(false)}><span>01</span><strong>System</strong><small>How OpenRails coordinates</small></NavLink>
          <NavLink to="/network" onClick={() => setMenuOpen(false)}><span>02</span><strong>Network</strong><small>Arc settlement evidence</small></NavLink>
          <NavLink to="/build" onClick={() => setMenuOpen(false)}><span>03</span><strong>Build</strong><small>SDK, MCP, and REST surfaces</small></NavLink>
          <NavLink to="/docs" onClick={() => setMenuOpen(false)}><span>04</span><strong>Docs</strong><small>Integration reference</small></NavLink>
        </nav>}
      </header>
      {children}
      {footer}
    </div>
  );
}
