import { useEffect, useState } from "react";
import { ProductShell } from "../gasok/components/ProductShell";
import { DOCS, NAV_GROUPS, ORDER, type Block } from "../lib/docsContent";
import "../gasok/styles.css";
import "../gasok/product.css";

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  }
  return <div className="or-doc-code"><header><span>{lang.toUpperCase()}</span><button type="button" onClick={copy}>{copied ? "COPIED" : "COPY"}</button></header><pre>{code}</pre></div>;
}

function BlockView({ block }: { block: Block }) {
  if (block.kind === "h2") return <h2>{block.text}</h2>;
  if (block.kind === "h3") return <h3>{block.text}</h3>;
  if (block.kind === "p") return <p>{block.text}</p>;
  if (block.kind === "code") return <CodeBlock lang={block.lang} code={block.code} />;
  if (block.kind === "callout") return <div className="or-doc-callout"><strong>{block.variant === "warn" ? "CAUTION" : "NOTE"}</strong>{block.text}</div>;
  if (block.kind === "list") return <div className="or-doc-list">{block.items.map((item) => <div key={item}><i /><span>{item}</span></div>)}</div>;
  if (block.kind === "kv") return <div className="or-doc-kv">{block.rows.map((row) => <div key={row.k}><span>{row.k}</span><span>{row.v}</span></div>)}</div>;
  if (block.kind === "steps") return <div className="or-doc-steps">{block.items.map((item) => <div key={item.n}><span>{item.n}</span><strong>{item.title}</strong><p>{item.body}</p></div>)}</div>;
  return null;
}

export default function Docs() {
  const [topic, setTopic] = useState("quickstart");

  useEffect(() => {
    function syncHash() {
      const requested = window.location.hash.slice(1);
      if (requested && DOCS[requested]) setTopic(requested);
    }
    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  function navigate(id: string) {
    setTopic(id);
    window.history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "auto" });
  }

  const doc = DOCS[topic];
  const index = ORDER.indexOf(topic as (typeof ORDER)[number]);
  const previous = index > 0 ? ORDER[index - 1] : null;
  const next = index >= 0 && index < ORDER.length - 1 ? ORDER[index + 1] : null;

  return <ProductShell><main className="or-docs"><section className="or-docs-hero"><div><span className="tech-label">DOCUMENTATION / VERSIONED INTERFACE</span><h1>Understand the system.<br /><b>Build against what is real.</b></h1><p>Product concepts, payment lifecycles, SDK and CLI usage, agent-facing MCP tools, REST boundaries, contract facts, relay behavior, and Arc settlement evidence in one reference.</p></div><div className="or-docs-map"><header><span>OPENRAILS / INTERFACE MAP</span><strong>PUBLIC SURFACES</strong></header><div><span>PRODUCT</span><strong>WORKSPACE + PAYMENTS</strong><small>OPERATING EXPERIENCE</small></div><i /><div><span>SDK</span><strong>TYPED INTEGRATION</strong><small>APPLICATIONS + SERVICES</small></div><i /><div><span>MCP</span><strong>AGENT TOOLS</strong><small>READ + PREPARE</small></div><i /><div><span>REST</span><strong>VERSIONED BOUNDARY</strong><small>PERSISTENCE + EXECUTION</small></div><i /><div className="live"><span>ARC</span><strong>CANONICAL SETTLEMENT</strong><small>VAULT + RECEIPT</small></div></div></section><div className="or-docs-layout"><aside className="or-docs-nav"><span>OPENRAILS / DOCUMENTATION</span><h2>Reference index.</h2>{NAV_GROUPS.map((group) => <section key={group.label}><span>{group.label.toUpperCase()}</span>{group.items.map(([id, label]) => <button type="button" className={topic === id ? "active" : ""} onClick={() => navigate(id)} key={id}>{label}</button>)}</section>)}</aside><article className="or-docs-content" key={topic}><header><span>{doc.eyebrow.toUpperCase()} / {String(index + 1).padStart(2, "0")}</span><h1>{doc.title}</h1><p>{doc.subtitle}</p></header><div className="or-doc-blocks">{doc.blocks.map((block, blockIndex) => <BlockView block={block} key={blockIndex} />)}</div><footer className="or-doc-pager">{previous ? <button type="button" onClick={() => navigate(previous)}>PREVIOUS<strong>{DOCS[previous].title}</strong></button> : <span />}{next ? <button type="button" onClick={() => navigate(next)}>NEXT<strong>{DOCS[next].title}</strong></button> : <span />}</footer></article></div></main></ProductShell>;
}
