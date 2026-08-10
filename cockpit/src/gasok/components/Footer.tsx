import { Link } from 'react-router-dom';
import { arcTestnet } from '../../lib/chain';

const lifecycle = ['OWN', 'AUTHORISE', 'COMMIT', 'PROVE', 'SETTLE', 'RESOLVE'];

export function Footer() {
  return (
    <footer className="site-footer">
      <div className="footer-rail" aria-label="OpenRails lifecycle">
        {lifecycle.map((item, index) => (
          <div key={item} className="footer-rail-step">
            <span>0{index + 1}</span><strong>{item}</strong>{index < lifecycle.length - 1 && <i />}
          </div>
        ))}
      </div>
      <div className="footer-main">
        <div className="footer-statement">
          <span className="tech-label">OPENRAILS / ARC</span>
          <h2>Authority made explicit.<br />Settlement made accountable.</h2>
          <p>The control, agreement, clearing, and settlement plane for programmable commerce on Arc.</p>
        </div>
        <div className="footer-links">
          <div><span>SYSTEM</span><Link to="/system">Workspace</Link><Link to="/system">Path</Link><Link to="/system">Pact</Link><Link to="/system">Proof</Link><Link to="/system">Gaia</Link></div>
          <div><span>BUILD</span><Link to="/build">Runtime</Link><Link to="/docs#sdk">SDK</Link><Link to="/docs#mcp">MCP</Link><Link to="/docs#api">REST</Link></div>
          <div><span>ARC</span><Link to="/app">Open Cockpit</Link><Link to="/network">Deployment</Link><a href={arcTestnet.blockExplorers.default.url} target="_blank" rel="noreferrer">Explorer ↗</a></div>
        </div>
      </div>
      <div className="footer-status">
        <span>ARC TESTNET / CHAIN {arcTestnet.id}</span>
        <span><i /> SYSTEM STATUS / TESTNET</span>
        <span>OPENRAILS / 2026</span>
      </div>
    </footer>
  );
}
