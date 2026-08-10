import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowRight, ChevronDown, CircleHelp, Plus, RefreshCw, X } from "lucide-react";
import { ProductShell } from "../gasok/components/ProductShell";
import { NewPaymentModal } from "../components/cockpit/NewPaymentModal";
import { useWalletConnection } from "../lib/useWalletConnection";
import { useIndexerStreams } from "../lib/useIndexerStreams";
import { fmtUsdcBase, humanDuration, shortHex } from "../lib/cockpitFormat";
import { sharedInterface, type SharedInterfaceCapabilities } from "../lib/sharedInterface";
import { useWorkspaceRecords, type WorkspaceActorType } from "../lib/workspace";
import { useRuntimeAccount } from "../lib/runtimeAccount";
import { guidanceScope, useFirstRunGuide } from "../lib/guidance";
import type { CircleSettlementResult } from "../lib/circleSettlement";
import "../gasok/styles.css";
import "../gasok/product.css";

const HUB = "0x941C8029F0f912df3fAb7423890ab2359b996D0b";
const USDC = "0x3600000000000000000000000000000000000000";

type CockpitView = "workspace" | "authority" | "payments" | "records" | "activity";

const views: { id: CockpitView; label: string; description: string }[] = [
  { id: "workspace", label: "Workspace", description: "Operating context and lifecycle" },
  { id: "authority", label: "Authority", description: "People, agents, Paths, and terms" },
  { id: "payments", label: "Payments", description: "Direct and Workspace-scoped value" },
  { id: "records", label: "Records", description: "Arc settlement evidence" },
  { id: "activity", label: "Activity", description: "Commercial and financial history" },
];

function WorkspaceInitialization({ owner, onClose, onInitialize }: { owner?: string; onClose: () => void; onInitialize: (name: string) => Promise<void> }) {
  const [name, setName] = useState("Procurement operations");
  function submit(event: FormEvent) {
    event.preventDefault();
    if (owner && name.trim()) void onInitialize(name.trim());
  }
  return (
    <div className="or-modal-backdrop" onMouseDown={onClose}>
      <section className="or-modal or-workspace-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><span>WORKSPACE / INITIALIZE</span><h2 id="workspace-title">Create an operating context.</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header>
        <form onSubmit={submit}>
          <p>A Workspace groups parties, delegated authority, accepted terms, Proof, payment references, and receipts. It does not custody funds.</p>
          <label><span>WORKSPACE NAME</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label><span>OWNER WALLET</span><input value={owner ?? "Connect a wallet first"} readOnly /></label>
          <div className="or-state-grid"><div><span>OBJECT</span><strong>DRAFT</strong></div><div><span>PERSISTENCE</span><strong>RUNTIME BACKED</strong></div><div><span>ARC EFFECT</span><strong>NONE</strong></div></div>
          <footer><button type="button" onClick={onClose}>Cancel</button><button className="primary" type="submit" disabled={!owner}>Record Workspace <ArrowRight size={14} /></button></footer>
        </form>
      </section>
    </div>
  );
}

function FirstRunGuide({ view, onSelect, onDismiss }: { view: CockpitView; onSelect: (view: CockpitView) => void; onDismiss: () => void }) {
  return (
    <div className="or-guide" role="dialog" aria-modal="true" aria-labelledby="guide-title">
      <button className="or-guide-close" type="button" onClick={onDismiss} aria-label="Close guide"><X size={15} /></button>
      <span>FIRST RUN / ORIENTATION</span>
      <h2 id="guide-title">Start with context, then move value.</h2>
      <p>Use a Workspace when a payment belongs to delegated work, accepted terms, or Proof. Use Direct Payment when the connected wallet only needs to pay a recipient.</p>
      <div>{views.map((item, index) => <button type="button" className={view === item.id ? "active" : ""} key={item.id} onClick={() => onSelect(item.id)}><b>0{index + 1}</b><strong>{item.label}</strong><small>{item.description}</small></button>)}</div>
      <footer><button type="button" className="primary" onClick={onDismiss}>Enter Cockpit <ArrowRight size={14} /></button></footer>
    </div>
  );
}

function LifecycleRail({ hasWorkspace, paths, pacts, proofs, payments }: { hasWorkspace: boolean; paths: number; pacts: number; proofs: number; payments: number }) {
  const steps = [
    ["01", "INITIALIZED", hasWorkspace],
    ["02", "AUTHORITY", paths > 0],
    ["03", "COMMITTED", pacts > 0],
    ["04", "PROVED", proofs > 0],
    ["05", "SETTLING", payments > 0],
    ["06", "RECEIPTED", payments > 0],
  ] as const;
  return <div className="or-lifecycle-rail" aria-label="Workspace lifecycle">{steps.map(([index, label, complete]) => <div className={complete ? "complete" : ""} key={label}><span>{index}</span><strong>{label}</strong><i /></div>)}</div>;
}

function EmptyWorkspace({ onInitialize }: { onInitialize: () => void }) {
  return <section className="or-empty-workspace"><span>WORKSPACE / NONE SELECTED</span><h2>Give work an operating context.</h2><p>Initialize a Workspace to organize participants, authority, terms, Proof, and Workspace-scoped payments. Direct payments remain available without one.</p><button className="primary" type="button" onClick={onInitialize}><Plus size={15} /> Initialize Workspace</button></section>;
}

function WorkspaceCanvas({ workspace, onNavigate }: { workspace: NonNullable<ReturnType<typeof useWorkspaceRecords>["selected"]>; onNavigate: (view: CockpitView) => void }) {
  const nodes = [
    ["OWNER", shortHex(workspace.owner), "RECORDED"],
    ["PARTIES", String(workspace.actors.length), workspace.actors.length ? "RECORDED" : "EMPTY"],
    ["PATHS", String(workspace.paths.length), workspace.paths.some((path) => path.state !== "Revoked") ? "ACTIVE" : "DRAFT"],
    ["PACTS", String(workspace.pacts.length), workspace.pacts.length ? "FORMING" : "EMPTY"],
    ["PROOF", String(workspace.proofs.length), workspace.proofs.length ? "SUBMITTED" : "AWAITING"],
  ];
  return (
    <section className="or-workspace-canvas">
      <div className="canvas-header"><div><span>{workspace.id}</span><strong>{workspace.name}</strong></div><div><span>PERSISTENCE</span><strong>{workspace.persistence === "runtime-backed" ? "RUNTIME BACKED" : "BROWSER CACHE"}</strong></div></div>
      <svg viewBox="0 0 920 420" preserveAspectRatio="none" aria-hidden="true"><path d="M140 210 L310 210 L470 110 L650 110" /><path d="M310 210 L470 310 L650 310" /><path d="M650 110 L790 210 L650 310" /></svg>
      <button className="or-core-node" type="button" onClick={() => onNavigate("workspace")}><span>WORKSPACE</span><strong>ACTIVE CONTEXT</strong><small>{workspace.id}</small></button>
      {nodes.map(([label, value, state], index) => <button type="button" className={`or-object-node node-${index + 1}`} key={label} onClick={() => onNavigate(index < 3 ? "authority" : index === 4 ? "records" : "workspace")}><span>{label}</span><strong>{value}</strong><small>{state}</small></button>)}
      <div className="canvas-legend"><span><i /> RUNTIME RECORD</span><span><i className="live" /> ARC EVIDENCE</span></div>
    </section>
  );
}

function AuthorityView({ workspace, records, address, onNotice }: { workspace: NonNullable<ReturnType<typeof useWorkspaceRecords>["selected"]>; records: ReturnType<typeof useWorkspaceRecords>; address?: string; onNotice: (message: string) => void }) {
  const [actorName, setActorName] = useState("");
  const [actorType, setActorType] = useState<WorkspaceActorType>("Person");
  const [actorAddress, setActorAddress] = useState(address ?? "");
  const [delegateId, setDelegateId] = useState("");
  const [capability, setCapability] = useState("CREATE_RAILSFLOW");
  const [ceiling, setCeiling] = useState("1000");
  const [pactTitle, setPactTitle] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [pactAmount, setPactAmount] = useState("250");
  const [proof, setProof] = useState("");
  const [proofRef, setProofRef] = useState("");

  return (
    <div className="or-operating-grid">
      <section className="or-operation-panel"><header><span>01 / PEOPLE + AGENTS</span><h2>Who can participate?</h2></header><form onSubmit={(event) => { event.preventDefault(); if (!actorName.trim()) return; void records.addActor({ name: actorName, type: actorType, address: actorAddress.trim() || undefined }).then((actor) => { setActorName(""); setActorAddress(address ?? ""); if (actorType === "Agent") setDelegateId(actor.id); }).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Actor registration failed.")); }}><label><span>WALLET ADDRESS</span><input value={actorAddress} onChange={(event) => setActorAddress(event.target.value)} placeholder="Participant wallet address" /></label><div className="or-form-row"><label><span>NAME</span><input value={actorName} onChange={(event) => setActorName(event.target.value)} placeholder="Participant or agent" /></label><label><span>TYPE</span><select value={actorType} onChange={(event) => setActorType(event.target.value as WorkspaceActorType)}><option>Person</option><option>Party</option><option>Application</option><option>Agent</option></select></label><button type="submit"><Plus size={14} /> Add</button></div></form><div className="or-record-list">{workspace.actors.length ? workspace.actors.map((actor) => <article key={actor.id}><span>{actor.type}</span><strong>{actor.name}<small>ACTOR ID / {actor.id}</small></strong><small>{actor.address ? shortHex(actor.address) : actor.state}</small></article>) : <p>No participants recorded.</p>}</div></section>
      <section className="or-operation-panel"><header><span>02 / PATH</span><h2>What may they do?</h2></header><form onSubmit={(event) => { event.preventDefault(); if (!delegateId.trim()) return; void records.addPath({ delegateId, capability, ceilingUsdc: ceiling, expiresAt: new Date(Date.now() + 86400000).toISOString() }).then(() => setDelegateId("")).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Path activation failed.")); }}><label><span>DELEGATE ID</span><input value={delegateId} onChange={(event) => setDelegateId(event.target.value)} placeholder="Actor or agent ID" /></label><label><span>CAPABILITY</span><input value={capability} onChange={(event) => setCapability(event.target.value)} /></label><label><span>MAXIMUM EXPOSURE / USDC</span><input type="number" min="0" value={ceiling} onChange={(event) => setCeiling(event.target.value)} /></label><button type="submit"><Plus size={14} /> Activate Path</button></form><div className="or-record-list">{workspace.paths.length ? workspace.paths.map((path) => <article key={path.id}><span>{path.state}</span><strong>{path.capability}</strong><small>{path.ceilingUsdc} USDC / {path.delegateId}</small></article>) : <p>No delegated Paths drafted.</p>}</div></section>
      <section className="or-operation-panel"><header><span>03 / PACT</span><h2>What was accepted?</h2></header><form onSubmit={(event) => { event.preventDefault(); if (!pactTitle.trim() || !counterparty.trim()) return; void records.addPact({ title: pactTitle, counterparty, amountUsdc: pactAmount }).then(() => setPactTitle("")).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Pact preparation failed.")); }}><label><span>COMMERCIAL TERMS</span><input value={pactTitle} onChange={(event) => setPactTitle(event.target.value)} placeholder="Deliverable or accepted terms" /></label><label><span>COUNTERPARTY WALLET</span><input value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="0x..." /></label><label><span>VALUE / USDC</span><input type="number" min="0" value={pactAmount} onChange={(event) => setPactAmount(event.target.value)} /></label><button type="submit"><Plus size={14} /> Commit Pact</button></form><div className="or-record-list">{workspace.pacts.length ? workspace.pacts.map((pact) => <article key={pact.id}><span>{pact.state}</span><strong>{pact.title}</strong><small>{pact.amountUsdc} USDC / {shortHex(pact.counterparty)}</small></article>) : <p>No Pacts prepared.</p>}</div></section>
      <section className="or-operation-panel"><header><span>04 / PROOF</span><h2>What evidence exists?</h2></header><form onSubmit={(event) => { event.preventDefault(); const pact = workspace.pacts.find((candidate) => candidate.state === "Committed") ?? workspace.pacts[0]; if (!proof.trim() || !pact) return; void records.addProof({ pactId: pact.id, description: proof, reference: proofRef }).then(() => { setProof(""); setProofRef(""); }).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Proof verification failed.")); }}><label><span>PROOF DESCRIPTION</span><input value={proof} onChange={(event) => setProof(event.target.value)} placeholder={workspace.pacts.length ? "Delivery or usage evidence" : "Commit a Pact first"} disabled={!workspace.pacts.length} /></label><label><span>REFERENCE</span><input value={proofRef} onChange={(event) => setProofRef(event.target.value)} placeholder="URI, hash, or receipt" disabled={!workspace.pacts.length} /></label><button type="submit" disabled={!workspace.pacts.length}><Plus size={14} /> Verify Proof</button></form><div className="or-record-list">{workspace.proofs.length ? workspace.proofs.map((item) => <article key={item.id}><span>{item.state}</span><strong>{item.description}</strong><small>{item.reference || item.pactId}</small></article>) : <p>No Proof submitted.</p>}</div></section>
    </div>
  );
}

export default function Cockpit() {
  const { address, isConnected } = useWalletConnection();
  const runtimeAccount = useRuntimeAccount(address);
  const records = useWorkspaceRecords(runtimeAccount.handle ?? undefined);
  const streams = useIndexerStreams();
  const guide = useFirstRunGuide(guidanceScope(address, records.selectedId || undefined));
  const [view, setView] = useState<CockpitView>("workspace");
  const [workspaceModal, setWorkspaceModal] = useState(false);
  const [paymentModal, setPaymentModal] = useState(false);
  const [paymentContext, setPaymentContext] = useState<"direct" | "workspace">("direct");
  const [selectedPayment, setSelectedPayment] = useState("");
  const [notice, setNotice] = useState("");
  const [capabilities, setCapabilities] = useState<SharedInterfaceCapabilities | null>(null);
  const [capabilitiesError, setCapabilitiesError] = useState(false);

  useEffect(() => {
    let live = true;
    sharedInterface.capabilities().then((value) => live && setCapabilities(value)).catch(() => live && setCapabilitiesError(true));
    return () => { live = false; };
  }, []);

  const selectedStream = useMemo(() => streams.streams.find((stream) => `${stream.vaultAddress}:${stream.paycardId}` === selectedPayment), [selectedPayment, streams.streams]);
  const workspace = records.selected;
  const workspaceSettlementCount = workspace?.payments.length ?? 0;

  function openWorkspace() {
    if (!isConnected) {
      setNotice("Connect a wallet from the control strip before initializing a Workspace.");
      return;
    }
    setWorkspaceModal(true);
  }

  function openPayment(context: "direct" | "workspace") {
    if (context === "workspace" && !workspace) {
      openWorkspace();
      return;
    }
    setPaymentContext(context);
    setPaymentModal(true);
  }

  return (
    <ProductShell>
      <main className="or-cockpit">
        <section className="or-cockpit-heading">
          <div><span className="tech-label">COCKPIT / OPERATING SURFACE</span><h1>One context.<br /><b>Verifiable movement.</b></h1><p>Coordinate authority, terms, Proof, direct payment, Workspace-scoped payment, and Arc settlement evidence without mixing browser records with canonical chain state.</p></div>
          <div className="or-cockpit-actions"><button type="button" onClick={() => openPayment("direct")}>Direct payment</button><button className="primary" type="button" onClick={() => workspace ? openPayment("workspace") : openWorkspace()}>{workspace ? "Workspace payment" : "Initialize Workspace"} <ArrowRight size={14} /></button></div>
        </section>

        <section className="or-account-strip">
          <label><span>WORKSPACE</span><div><select value={records.selectedId} onChange={(event) => records.select(event.target.value)}><option value="">Direct operations</option>{records.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div></label>
          <div><span>WALLET</span><strong>{address ? shortHex(address) : "NOT CONNECTED"}</strong><small>{isConnected ? "READY" : "CONNECT TO AUTHORIZE"}</small></div>
          <div><span>INTERFACE</span><strong>{capabilities?.interfaceVersion ?? (capabilitiesError ? "UNAVAILABLE" : "CHECKING")}</strong><small>VERSIONED BOUNDARY</small></div>
          <div><span>INDEXER</span><strong>{streams.status.toUpperCase()}</strong><small>NON-AUTHORITATIVE READS</small></div>
          <button type="button" onClick={() => streams.refresh()} disabled={streams.refreshing}><RefreshCw size={14} /> Refresh</button>
        </section>

        <LifecycleRail hasWorkspace={Boolean(workspace)} paths={workspace?.paths.length ?? 0} pacts={workspace?.pacts.length ?? 0} proofs={workspace?.proofs.length ?? 0} payments={workspaceSettlementCount} />

        <nav className="or-cockpit-tabs" aria-label="Cockpit views">{views.map((item, index) => <button type="button" className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} key={item.id}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.description}</small></button>)}<button className="guide" type="button" onClick={() => guide.restart()}><CircleHelp size={15} /> Guide</button></nav>

        {notice && <div className="or-notice"><span>NOTICE</span><strong>{notice}</strong><button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}

        {view === "workspace" && (workspace ? <><WorkspaceCanvas workspace={workspace} onNavigate={setView} /><section className="or-workspace-inspector"><div><span>OBJECT STATE</span><strong>{workspace.objectState}</strong></div><div><span>OWNER</span><strong>{shortHex(workspace.owner)}</strong></div><div><span>CREATED</span><strong>{new Date(workspace.createdAt).toLocaleDateString()}</strong></div><div><span>FINANCIAL EFFECT</span><strong>NO VALUE HELD</strong></div><button type="button" onClick={() => setView("authority")}>Manage authority <ArrowRight size={14} /></button></section></> : <EmptyWorkspace onInitialize={openWorkspace} />)}

        {view === "authority" && (workspace ? <AuthorityView workspace={workspace} records={records} address={address} onNotice={setNotice} /> : <EmptyWorkspace onInitialize={openWorkspace} />)}

        {view === "payments" && <section className="or-payment-surface"><header><div><span>PAYMENTS / ARC</span><h2>Choose the context first.</h2><p>Direct payments bind value to the connected wallet and recipient. Workspace-scoped payments additionally bind the payment metadata to the selected operating context.</p></div><div><button type="button" onClick={() => openPayment("direct")}>New direct payment</button><button className="primary" type="button" onClick={() => openPayment("workspace")} disabled={!workspace}>New Workspace payment</button></div></header><div className="or-payment-metrics"><div><span>ACTIVE STREAMS</span><strong>{streams.active.length}</strong></div><div><span>FLOW RATE</span><strong>{fmtUsdcBase(streams.velocityBase)} USDC/s</strong></div><div><span>SETTLED</span><strong>{fmtUsdcBase(streams.settledBase)} USDC</strong></div><div><span>WATCHED VAULTS</span><strong>{streams.vaults.length}</strong></div></div><div className="or-payment-table"><div className="or-table-head"><span>STATE</span><span>RECIPIENT</span><span>ALLOCATION</span><span>RATE</span><span>DURATION</span><span>RECORD</span></div>{streams.status === "loading" && <p>Loading indexed settlement state…</p>}{streams.status === "error" && <p>Indexer unavailable: {streams.errorMsg}</p>}{streams.status === "empty" && <p>No indexed payments yet. Create a direct or Workspace-scoped payment.</p>}{streams.streams.map((stream) => <button type="button" key={`${stream.vaultAddress}:${stream.paycardId}`} onClick={() => setSelectedPayment(`${stream.vaultAddress}:${stream.paycardId}`)}><span><i className={stream.status === "Active" ? "live" : ""} />{stream.status === "Active" ? "STREAMING" : "CLOSED"}</span><strong>{shortHex(stream.recipient)}</strong><strong>{fmtUsdcBase(stream.totalAllocation)} USDC</strong><strong>{fmtUsdcBase(stream.velocity)} USDC/s</strong><strong>{humanDuration(stream.lifespan)}</strong><code>{shortHex(stream.paycardId)}</code></button>)}</div></section>}

        {view === "records" && <section className="or-record-surface"><header><span>RECORDS / PROJECTION + CANONICAL STATE</span><h2>Trace what cleared.</h2><p>The indexer is a discoverable projection. Vault state and Arc transaction receipts remain canonical.</p></header><div className="or-record-ledger">{streams.streams.length ? streams.streams.map((stream, index) => <button type="button" onClick={() => setSelectedPayment(`${stream.vaultAddress}:${stream.paycardId}`)} key={`${stream.vaultAddress}:${stream.paycardId}`}><span>0{index + 1}</span><strong>{stream.status === "Active" ? "PAYMENT STREAMING" : "PAYMENT CLOSED"}</strong><code>{shortHex(stream.vaultAddress)} / {shortHex(stream.paycardId)}</code><small>{fmtUsdcBase(stream.totalAllocation)} USDC</small><b>INSPECT ↗</b></button>) : <p>No settlement records discovered.</p>}</div></section>}

        {view === "activity" && <section className="or-activity-surface"><header><span>ACTIVITY / WORKSPACE + SETTLEMENT</span><h2>History without false equivalence.</h2></header><div>{workspace?.activity.map((item) => <article key={item.id}><time>{new Date(item.createdAt).toLocaleTimeString()}</time><span>WORKSPACE</span><strong>{item.label}</strong><p>{item.detail}</p><small>{item.state} / {item.financialEffect}</small></article>)}{streams.streams.map((stream) => <article key={`${stream.vaultAddress}:${stream.paycardId}`}><time>{new Date(stream.updatedAt).toLocaleTimeString()}</time><span>ARC INDEXER</span><strong>{stream.status === "Active" ? "Payment streaming" : "Payment closed"}</strong><p>{shortHex(stream.paycardId)} / {fmtUsdcBase(stream.totalAllocation)} USDC</p><small>Non-authoritative projection</small></article>)}{!workspace?.activity.length && !streams.streams.length && <p>No activity recorded.</p>}</div></section>}

        {selectedStream && <aside className="or-payment-inspector"><button type="button" onClick={() => setSelectedPayment("")} aria-label="Close inspector"><X size={15} /></button><span>PAYMENT / INSPECTOR</span><h2>{selectedStream.status === "Active" ? "Streaming" : "Closed"}</h2><p>The indexer found this payment. Verify canonical state against the Vault before relying on it for settlement decisions.</p><dl><div><dt>PAYER</dt><dd>{shortHex(selectedStream.payer)}</dd></div><div><dt>RECIPIENT</dt><dd>{shortHex(selectedStream.recipient)}</dd></div><div><dt>ALLOCATION</dt><dd>{fmtUsdcBase(selectedStream.totalAllocation)} USDC</dd></div><div><dt>AVAILABLE</dt><dd>{fmtUsdcBase(selectedStream.availableBalance)} USDC</dd></div><div><dt>RATE</dt><dd>{fmtUsdcBase(selectedStream.velocity)} USDC/s</dd></div><div><dt>PAYMENT ID</dt><dd>{shortHex(selectedStream.paycardId, 10, 8)}</dd></div><div><dt>VAULT</dt><dd>{shortHex(selectedStream.vaultAddress, 10, 8)}</dd></div></dl><div className="or-binding-chain"><span>VERIFIABLE LIFECYCLE</span><code>CONTEXT → AUTHORIZATION → TERMS → PAYMENT ID → ARC VAULT → RECEIPT</code></div></aside>}
      </main>

      {guide.open && <FirstRunGuide view={view} onSelect={setView} onDismiss={guide.dismiss} />}
      {workspaceModal && <WorkspaceInitialization owner={address} onClose={() => setWorkspaceModal(false)} onInitialize={async (name) => { try { await records.initialize(name, address!); setWorkspaceModal(false); setView("workspace"); } catch (error) { setNotice(error instanceof Error ? error.message : "Workspace initialization failed."); } }} />}
      <NewPaymentModal open={paymentModal} onClose={() => setPaymentModal(false)} hub={HUB} usdc={USDC} workspace={workspace ? { id: workspace.id, name: workspace.name } : null} initialContext={paymentContext} onSuccess={(paycardId) => { if (paymentContext === "workspace" && workspace) records.recordPayment(paycardId); setNotice(`Payment ${shortHex(paycardId)} submitted. Waiting for indexer discovery.`); setPaymentModal(false); setView("payments"); streams.refresh(); }} onCircleSuccess={(result: CircleSettlementResult) => { if (paymentContext === "workspace" && workspace) records.recordPayment(result.paycardId); setNotice(`Sponsored payment ${shortHex(result.paycardId)} confirmed and verified.`); setPaymentModal(false); setView("payments"); streams.refresh(); }} />
    </ProductShell>
  );
}
