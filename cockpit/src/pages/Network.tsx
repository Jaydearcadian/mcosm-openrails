import { Link } from "react-router-dom";
import { Footer } from "../gasok/components/Footer";
import { ProductShell } from "../gasok/components/ProductShell";
import { arcTestnet, ARC_RPC_URLS } from "../lib/chain";
import { useIndexerStreams } from "../lib/useIndexerStreams";
import "../gasok/styles.css";

const contracts = {
  "USDC": "0x3600000000000000000000000000000000000000",
  "CANONICAL HUB": "0x941C8029F0f912df3fAb7423890ab2359b996D0b",
  "VAULT FACTORY": "0xf85c20858Bac4f9C67a53e4e7a8F31025D07Bc93",
  "MASTER LOGIC": "0x489B3528118937D070496ac70467F1D02691207c",
};

export default function Network() {
  const indexed = useIndexerStreams();
  const explorer = arcTestnet.blockExplorers.default.url;
  return <ProductShell footer={<Footer />}><main className="editorial-page network-page"><section className="page-hero"><span className="tech-label">NETWORK / LIVE ON ARC</span><h1>Arc deployment,<br /><span>made inspectable.</span></h1><p>Canonical contracts, chain configuration, provider boundaries, indexed projections, and transaction evidence for the OpenRails Arc Testnet deployment.</p></section><section className="network-stats"><div><span>CHAIN ID</span><strong>{arcTestnet.id}</strong></div><div><span>NETWORK</span><strong>ARC TESTNET</strong></div><div><span>SETTLEMENT</span><strong>USDC</strong></div><div><span>INDEXER</span><strong>{indexed.status.toUpperCase()}</strong></div></section><section className="network-operation"><div className="network-operation-copy"><span className="tech-label">PROVIDER BOUNDARY</span><h2>Arc is canonical. Providers are replaceable.</h2><p>The configured RPC list includes a managed primary when provisioned and public Arc fallbacks. Indexed data improves discovery but never replaces Vault state or transaction receipts.</p></div><div className="network-operation-panel"><div><span>RPC ROUTES</span><strong><i /> {ARC_RPC_URLS.length} CONFIGURED</strong></div><div><span>INDEXED STREAMS</span><strong>{indexed.streams.length}</strong></div><div><span>WATCHED VAULTS</span><strong>{indexed.vaults.length}</strong></div><a href={explorer} target="_blank" rel="noreferrer">Open Arc explorer ↗</a></div></section><section className="ledger-section"><div className="section-index"><span>01</span><strong>DEPLOYED CONTRACTS</strong></div><div className="ledger">{Object.entries(contracts).map(([name, address], index) => <a href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer" className="ledger-row" key={name}><span className="ledger-index">0{index + 1}</span><strong>{name}</strong><code>{address}</code><span className="live-label"><i /> LIVE ON ARC</span><b>↗</b></a>)}</div></section><section className="network-closing"><span>02 / CANONICAL EVIDENCE</span><h2>Commercial state explains why value should move.<br />Arc proves that it did.</h2><Link to="/app">Open the operating Cockpit →</Link></section></main></ProductShell>;
}
