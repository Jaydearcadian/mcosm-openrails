import { useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, CircleHelp, ListChecks, Plus, RefreshCw, X } from "lucide-react";
import { ProductShell } from "../gasok/components/ProductShell";
import { NewPaymentModal } from "../components/cockpit/NewPaymentModal";
import { useWalletConnection } from "../lib/useWalletConnection";
import { useIndexerStreams } from "../lib/useIndexerStreams";
import { fmtUsdcBase, humanDuration, shortHex } from "../lib/cockpitFormat";
import { sharedInterface, type SharedInterfaceCapabilities } from "../lib/sharedInterface";
import { useWorkspaceRecords, type WorkspaceActorType } from "../lib/workspace";
import { useRuntimeAccount } from "../lib/runtimeAccount";
import { guidanceScope, useFirstRunGuide, useNavigatorPreference } from "../lib/guidance";
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

const orientationSteps = [
  {
    target: "wallet-control",
    eyebrow: "01 / WALLET + NETWORK",
    title: "Start with the wallet that will authorize actions.",
    body: "Connect from the top-right control. OpenRails coordinates records and prepared actions, but your wallet remains the signing authority. If needed, this same control switches you to Arc.",
  },
  {
    target: "direct-payment",
    eyebrow: "02 / DIRECT PAYMENT",
    title: "Send once or stream without creating a Workspace.",
    body: "Use Direct Payment when the transaction stands on its own. You can choose one-time or streaming settlement, review the exact terms, then authorize with the connected wallet.",
  },
  {
    target: "workspace-entry",
    eyebrow: "03 / WORKSPACE",
    title: "Give delegated work an operating context.",
    body: "Initialize a Workspace when participants, permissions, accepted terms, Proof, payments, and receipts need to stay connected. The Workspace records context; it does not custody funds.",
  },
  {
    target: "lifecycle",
    eyebrow: "04 / LIFECYCLE",
    title: "See what is complete and what comes next.",
    body: "This rail advances as the Workspace is initialized, authority is activated, terms are committed, Proof is recorded, and payment reaches settlement and receipt states.",
  },
  {
    target: "app-views",
    eyebrow: "05 / APP VIEWS",
    title: "Move through one connected operating record.",
    body: "Workspace shows the context, Authority manages participants and limits, Payments moves value, Records verifies settlement evidence, and Activity keeps the lifecycle readable.",
  },
] as const;

const workspaceGuideSteps: { view: CockpitView; target: string; eyebrow: string; title: string; body: string }[] = [
  { view: "workspace", target: "workspace", eyebrow: "01 / CONTEXT", title: "This is the job's operating record.", body: "The Workspace keeps participants, permissions, terms, Proof, payments, and receipts connected without taking custody of funds." },
  { view: "authority", target: "authority", eyebrow: "02 / PEOPLE + LIMITS", title: "Add participants, then define what they may do.", body: "A Path is a bounded permission for a wallet-linked person, business, application, or agent. It states the allowed action, maximum exposure, and expiry." },
  { view: "authority", target: "authority", eyebrow: "03 / TERMS + PROOF", title: "Record the agreement and evidence.", body: "A Pact records accepted commercial terms. Proof links delivery or usage evidence to those terms before the payment lifecycle is treated as complete." },
  { view: "payments", target: "payments", eyebrow: "04 / VALUE", title: "Pay once or release value over time.", body: "Direct payments stand alone. Workspace-scoped payments bind the payment reference to this operating context so the commercial and financial records remain traceable." },
  { view: "records", target: "records", eyebrow: "05 / RECEIPT", title: "Verify what actually settled.", body: "Records connect the payment ID to Arc Vault state and transaction evidence. Indexer results are for discovery; the chain receipt remains canonical." },
  { view: "activity", target: "activity", eyebrow: "06 / HISTORY", title: "Follow the full lifecycle in one timeline.", body: "Activity keeps signed Workspace changes and indexed settlement events visible without presenting a browser record as if it were an onchain transaction." },
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

function TermHelp({ term, children }: { term: string; children: string }) {
  return (
    <details className="or-term-help">
      <summary aria-label={`Explain ${term}`} title={`Explain ${term}`}><CircleHelp size={14} /></summary>
      <div role="tooltip"><strong>{term}</strong><p>{children}</p></div>
    </details>
  );
}

function FirstRunGuide({ step, onStep, onDismiss }: { step: number; onStep: (step: number) => void; onDismiss: () => void }) {
  const currentIndex = Math.min(step, orientationSteps.length - 1);
  const current = orientationSteps[currentIndex];
  const last = currentIndex === orientationSteps.length - 1;

  useEffect(() => {
    const target = document.querySelector<HTMLElement>(`[data-tour-target="${current.target}"]`);
    target?.classList.add("or-tour-focus");
    const timer = window.setTimeout(() => target?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => {
      window.clearTimeout(timer);
      target?.classList.remove("or-tour-focus");
    };
  }, [current.target]);

  return (
    <aside className="or-guide" aria-labelledby="guide-title">
      <button className="or-guide-close" type="button" onClick={onDismiss} aria-label="Close guide"><X size={15} /></button>
      <span>QUICK TOUR / {String(currentIndex + 1).padStart(2, "0")} OF {String(orientationSteps.length).padStart(2, "0")}</span>
      <div className="or-guide-progress" aria-label={`Quick tour step ${currentIndex + 1} of ${orientationSteps.length}`}>{orientationSteps.map((item, index) => <i className={index <= currentIndex ? "active" : ""} key={item.eyebrow} />)}</div>
      <article className="or-guide-card">
        <span>{current.eyebrow}</span>
        <h2 id="guide-title">{current.title}</h2>
        <p>{current.body}</p>
      </article>
      <footer>
        {currentIndex > 0 ? <button type="button" onClick={() => onStep(currentIndex - 1)}><ArrowLeft size={14} /> Back</button> : <span />}
        {!last ? <button type="button" className="primary" onClick={() => onStep(currentIndex + 1)}>Next <ArrowRight size={14} /></button> : <button type="button" className="primary" onClick={onDismiss}>Finish tour <Check size={14} /></button>}
      </footer>
    </aside>
  );
}

type SetupStep = {
  id: string;
  label: string;
  detail: string;
  complete: boolean;
  actionLabel: string;
  action: () => void;
};

function SetupNavigator({ steps, open, onOpenChange, onQuickTour }: { steps: SetupStep[]; open: boolean; onOpenChange: (open: boolean) => void; onQuickTour: () => void }) {
  const completed = steps.filter((step) => step.complete).length;
  const next = steps.find((step) => !step.complete);

  if (!open) {
    return <button className="or-setup-reopen" type="button" onClick={() => onOpenChange(true)}><ListChecks size={15} /><span>Setup guide</span><strong>{completed}/{steps.length}</strong></button>;
  }

  return (
    <section className="or-setup-navigator" aria-labelledby="setup-guide-title">
      <header>
        <div><span>GETTING STARTED / LIVE CHECKLIST</span><h2 id="setup-guide-title">Complete the operating path.</h2></div>
        <div><button type="button" onClick={onQuickTour}><CircleHelp size={14} /> Quick tour</button><button type="button" onClick={() => onOpenChange(false)} aria-label="Collapse setup guide"><ChevronUp size={15} /></button></div>
      </header>
      <div className="or-setup-progress"><i style={{ width: `${(completed / steps.length) * 100}%` }} /><span>{completed} of {steps.length} complete</span></div>
      <div className="or-setup-steps">
        {steps.map((step, index) => <article className={step.complete ? "complete" : step.id === next?.id ? "current" : ""} key={step.id}><span>{step.complete ? <Check size={13} /> : String(index + 1).padStart(2, "0")}</span><div><strong>{step.label}</strong><small>{step.detail}</small></div>{!step.complete && <button type="button" onClick={step.action}>{step.actionLabel} <ArrowRight size={13} /></button>}</article>)}
      </div>
      {next ? <footer><div><span>NEXT ACTION</span><strong>{next.label}</strong></div><button className="primary" type="button" onClick={next.action}>{next.actionLabel} <ArrowRight size={14} /></button></footer> : <footer className="complete"><div><span>WORKSPACE PATH</span><strong>Ready for continued operation</strong></div><Check size={18} /></footer>}
    </section>
  );
}

function WorkspaceGuide({ step, onStep, onDismiss, onSelect, onOverview }: { step: number; onStep: (step: number) => void; onDismiss: () => void; onSelect: (view: CockpitView) => void; onOverview: () => void }) {
  const currentIndex = Math.min(step, workspaceGuideSteps.length - 1);
  const current = workspaceGuideSteps[currentIndex];
  const last = currentIndex === workspaceGuideSteps.length - 1;

  useEffect(() => {
    onSelect(current.view);
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>(`[data-tour-target="${current.target}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    return () => window.clearTimeout(timer);
  }, [current.target, current.view, onSelect]);

  return (
    <aside className="or-workspace-guide" aria-label="Workspace guide">
      <header><span>WORKSPACE GUIDE / {String(currentIndex + 1).padStart(2, "0")} OF {String(workspaceGuideSteps.length).padStart(2, "0")}</span><button type="button" onClick={onDismiss} aria-label="Close Workspace guide"><X size={14} /></button></header>
      <div className="or-workspace-guide-progress">{workspaceGuideSteps.map((item, index) => <i className={index <= currentIndex ? "active" : ""} key={item.eyebrow} />)}</div>
      <article><span>{current.eyebrow}</span><h2>{current.title}</h2><p>{current.body}</p></article>
      <footer>
        <button type="button" onClick={onOverview}>App overview</button>
        <div><button type="button" onClick={() => onStep(Math.max(0, currentIndex - 1))} disabled={currentIndex === 0} aria-label="Previous guide step"><ArrowLeft size={14} /></button>{last ? <button type="button" className="primary" onClick={onDismiss}>Finish</button> : <button type="button" className="primary" onClick={() => onStep(currentIndex + 1)}>Next <ArrowRight size={14} /></button>}</div>
      </footer>
    </aside>
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
  return <div className="or-lifecycle-rail" aria-label="Workspace lifecycle" data-tour-target="lifecycle">{steps.map(([index, label, complete]) => <div className={complete ? "complete" : ""} key={label}><span>{index}</span><strong>{label}</strong><i /></div>)}</div>;
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

function AuthorityView({ workspace, records, address, onNotice, tourActive }: { workspace: NonNullable<ReturnType<typeof useWorkspaceRecords>["selected"]>; records: ReturnType<typeof useWorkspaceRecords>; address?: string; onNotice: (message: string) => void; tourActive?: boolean }) {
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
  const delegateCandidates = useMemo(() => workspace.actors.filter((actor) => Boolean(actor.address)), [workspace.actors]);

  const activePath = workspace.paths.find((path) => path.state === "Active");
  const activeDelegate = workspace.actors.find((actor) => actor.id === activePath?.delegateId);
  const activeDelegateRuntime = useRuntimeAccount(activeDelegate?.address);
  const pactSignerLabel = !activePath
    ? "Activate a Path first"
    : activeDelegateRuntime.handle
      ? `${activeDelegate?.name ?? "Participant"} wallet ready`
      : `Connect ${activeDelegate?.name ?? "participant"} wallet`;

  return (
    <div className={`or-operating-grid ${tourActive ? "or-tour-focus" : ""}`} data-tour-target="authority">
      <section className="or-operation-panel" data-helper-target="people">
        <header><span>01 / PEOPLE + AGENTS</span><h2>Who can participate?</h2></header>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!actorName.trim()) return;
          void records.addActor({ name: actorName, type: actorType, address: actorAddress.trim() || undefined })
            .then((actor) => {
              setActorName("");
              setActorAddress("");
              if (actor.walletAddress) setDelegateId(actor.id);
              else onNotice("Participant recorded. Add a wallet address before assigning a Path.");
            })
            .catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Actor registration failed."));
        }}>
          <label><span>WALLET ADDRESS</span><input value={actorAddress} onChange={(event) => setActorAddress(event.target.value)} placeholder="Participant wallet address" /></label>
          <div className="or-form-row"><label><span>NAME</span><input value={actorName} onChange={(event) => setActorName(event.target.value)} placeholder="Participant or agent" /></label><label><span>TYPE</span><select value={actorType} onChange={(event) => setActorType(event.target.value as WorkspaceActorType)}><option>Person</option><option>Party</option><option>Application</option><option>Agent</option></select></label><button type="submit"><Plus size={14} /> Add</button></div>
        </form>
        <div className="or-record-list">{workspace.actors.length ? workspace.actors.map((actor) => <article key={actor.id}><span>{actor.type}</span><strong>{actor.name}<small>PARTICIPANT ID / {actor.id}</small></strong><small>{actor.address ? shortHex(actor.address) : "WALLET REQUIRED"}</small></article>) : <p>No participants recorded.</p>}</div>
      </section>
      <section className="or-operation-panel" data-helper-target="path">
        <header><span>02 / PATH</span><div className="or-heading-with-help"><h2>What may they do?</h2><TermHelp term="Path">A Path is a permission with explicit limits. It defines which wallet-linked participant may act, what they may do, how much value is allowed, and when that authority expires.</TermHelp></div></header>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!delegateId.trim()) return;
          void records.addPath({ delegateId, capability, ceilingUsdc: ceiling, expiresAt: new Date(Date.now() + 86400000).toISOString() })
            .then(() => setDelegateId(""))
            .catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Path activation failed."));
        }}>
          <label><span>PARTICIPANT</span><select value={delegateId} onChange={(event) => setDelegateId(event.target.value)} disabled={!delegateCandidates.length}><option value="">{delegateCandidates.length ? "Choose a wallet-bound participant" : "Add a participant wallet first"}</option>{delegateCandidates.map((actor) => <option value={actor.id} key={actor.id}>{actor.name} / {actor.type}</option>)}</select></label>
          <label><span>CAPABILITY</span><input value={capability} onChange={(event) => setCapability(event.target.value)} /></label>
          <label><span>MAXIMUM EXPOSURE / USDC</span><input type="number" min="0" value={ceiling} onChange={(event) => setCeiling(event.target.value)} /></label>
          <button type="submit" disabled={!delegateId}><Plus size={14} /> Activate Path</button>
        </form>
        <div className="or-record-list">{workspace.paths.length ? workspace.paths.map((path) => { const delegate = workspace.actors.find((actor) => actor.id === path.delegateId); return <article key={path.id}><span>{path.state}</span><strong>{path.capability}</strong><small>{path.ceilingUsdc} USDC / {delegate?.name ?? path.delegateId}</small></article>; }) : <p>No delegated Paths drafted.</p>}</div>
      </section>
      <section className="or-operation-panel" data-helper-target="pact">
        <header><span>03 / PACT</span><div className="or-heading-with-help"><h2>What was accepted?</h2><TermHelp term="Pact">A Pact is the accepted commercial record: the parties, deliverable, value, and terms that the payment and Proof refer back to.</TermHelp></div></header>
        <form onSubmit={(event) => {
          event.preventDefault();
          if (!pactTitle.trim() || !counterparty.trim()) return;
          const delegateHandle = activeDelegateRuntime.handle;
          if (!delegateHandle) {
            onNotice("Connect the active Path participant wallet before committing the Pact.");
            return;
          }
          void records.addPact({ title: pactTitle, counterparty, amountUsdc: pactAmount }, delegateHandle)
            .then(() => setPactTitle(""))
            .catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Pact preparation failed."));
        }}>
          <label><span>COMMERCIAL TERMS</span><input value={pactTitle} onChange={(event) => setPactTitle(event.target.value)} placeholder="Deliverable or accepted terms" /></label>
          <label><span>PARTICIPANT SIGNER</span><input value={pactSignerLabel} readOnly /></label>
          <label><span>COUNTERPARTY WALLET</span><input value={counterparty} onChange={(event) => setCounterparty(event.target.value)} placeholder="0x..." /></label>
          <label><span>VALUE / USDC</span><input type="number" min="0" value={pactAmount} onChange={(event) => setPactAmount(event.target.value)} /></label>
          <button type="submit" disabled={!activeDelegateRuntime.handle}><Plus size={14} /> Commit Pact</button>
        </form>
        <div className="or-record-list">{workspace.pacts.length ? workspace.pacts.map((pact) => <article key={pact.id}><span>{pact.state}</span><strong>{pact.title}</strong><small>{pact.amountUsdc} USDC / {shortHex(pact.counterparty)}</small></article>) : <p>No Pacts prepared.</p>}</div>
      </section>
      <section className="or-operation-panel" data-helper-target="proof"><header><span>04 / PROOF</span><div className="or-heading-with-help"><h2>What evidence exists?</h2><TermHelp term="Proof">Proof is delivery or usage evidence linked to a Pact. It helps establish that the agreed condition occurred before the lifecycle is treated as complete.</TermHelp></div></header><form onSubmit={(event) => { event.preventDefault(); const pact = workspace.pacts.find((candidate) => candidate.state === "Committed") ?? workspace.pacts[0]; if (!proof.trim() || !pact) return; void records.addProof({ pactId: pact.id, description: proof, reference: proofRef }).then(() => { setProof(""); setProofRef(""); }).catch((error: unknown) => onNotice(error instanceof Error ? error.message : "Proof verification failed.")); }}><label><span>PROOF DESCRIPTION</span><input value={proof} onChange={(event) => setProof(event.target.value)} placeholder={workspace.pacts.length ? "Delivery or usage evidence" : "Commit a Pact first"} disabled={!workspace.pacts.length} /></label><label><span>REFERENCE</span><input value={proofRef} onChange={(event) => setProofRef(event.target.value)} placeholder="URI, hash, or receipt" disabled={!workspace.pacts.length} /></label><button type="submit" disabled={!workspace.pacts.length}><Plus size={14} /> Verify Proof</button></form><div className="or-record-list">{workspace.proofs.length ? workspace.proofs.map((item) => <article key={item.id}><span>{item.state}</span><strong>{item.description}</strong><small>{item.reference || item.pactId}</small></article>) : <p>No Proof submitted.</p>}</div></section>
    </div>
  );
}

export default function Cockpit() {
  const { address, isConnected } = useWalletConnection();
  const runtimeAccount = useRuntimeAccount(address);
  const records = useWorkspaceRecords(runtimeAccount.handle ?? undefined);
  const streams = useIndexerStreams();
  const orientationGuide = useFirstRunGuide("app", "orientation");
  const workspaceGuide = useFirstRunGuide(guidanceScope(address, records.selectedId || undefined), "workspace");
  const navigator = useNavigatorPreference(guidanceScope(address, records.selectedId || undefined));
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
  const activeTourTarget = workspaceGuide.open && !orientationGuide.open ? workspaceGuideSteps[Math.min(workspaceGuide.step, workspaceGuideSteps.length - 1)].target : "";

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

  function restartOverview() {
    workspaceGuide.dismiss();
    orientationGuide.restart();
  }

  function focusTarget(selector: string, message?: string) {
    if (message) setNotice(message);
    window.setTimeout(() => {
      const target = document.querySelector<HTMLElement>(selector);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      target?.classList.add("or-helper-pulse");
      window.setTimeout(() => target?.classList.remove("or-helper-pulse"), 1400);
    }, 80);
  }

  function openAuthorityHelper(target: "people" | "path" | "pact" | "proof") {
    setView("authority");
    focusTarget(`[data-helper-target="${target}"]`);
  }

  const setupSteps: SetupStep[] = [
    {
      id: "wallet",
      label: "Connect an authorizing wallet",
      detail: "The wallet signs records and approves value movement.",
      complete: isConnected,
      actionLabel: "Find Connect",
      action: () => focusTarget('[data-tour-target="wallet-control"]', "Use Connect in the top-right control to authorize App actions."),
    },
    {
      id: "workspace",
      label: "Initialize a Workspace",
      detail: "Create the operating context for participants, terms, Proof, and payment records.",
      complete: Boolean(workspace),
      actionLabel: "Initialize",
      action: openWorkspace,
    },
    {
      id: "participant",
      label: "Add a wallet-bound participant",
      detail: "Record the person, business, application, or agent that will participate.",
      complete: Boolean(workspace?.actors.some((actor) => Boolean(actor.address))),
      actionLabel: "Add participant",
      action: () => workspace ? openAuthorityHelper("people") : openWorkspace(),
    },
    {
      id: "path",
      label: "Activate bounded authority",
      detail: "Set what the participant may do, their maximum exposure, and expiry.",
      complete: Boolean(workspace?.paths.some((path) => path.state === "Active")),
      actionLabel: "Create Path",
      action: () => workspace ? openAuthorityHelper("path") : openWorkspace(),
    },
    {
      id: "pact",
      label: "Commit accepted terms",
      detail: "Bind the counterparties, deliverable, and value to the commercial record.",
      complete: Boolean(workspace?.pacts.some((pact) => pact.state === "Committed")),
      actionLabel: "Create Pact",
      action: () => workspace ? openAuthorityHelper("pact") : openWorkspace(),
    },
    {
      id: "proof",
      label: "Record delivery or usage Proof",
      detail: "Attach evidence to the committed terms before treating the work as complete.",
      complete: Boolean(workspace?.proofs.length),
      actionLabel: "Add Proof",
      action: () => workspace ? openAuthorityHelper("proof") : openWorkspace(),
    },
    {
      id: "payment",
      label: "Create a Workspace payment",
      detail: "Pay once or stream value while preserving the Workspace reference.",
      complete: Boolean(workspace?.payments.length),
      actionLabel: "New payment",
      action: () => workspace ? openPayment("workspace") : openWorkspace(),
    },
  ];

  return (
    <ProductShell>
      <main className="or-cockpit">
        <section className="or-cockpit-heading">
          <div><span className="tech-label">APP / OPERATING SURFACE</span><h1>One context.<br /><b>Verifiable movement.</b></h1><p>Coordinate authority, terms, Proof, direct payment, Workspace-scoped payment, and Arc settlement evidence without mixing browser records with canonical chain state.</p></div>
          <div className="or-cockpit-actions"><button type="button" data-tour-target="direct-payment" onClick={() => openPayment("direct")}>Direct payment</button><button className="primary" data-tour-target="workspace-entry" type="button" onClick={() => workspace ? openPayment("workspace") : openWorkspace()}>{workspace ? "Workspace payment" : "Initialize Workspace"} <ArrowRight size={14} /></button></div>
        </section>

        <section className="or-account-strip">
          <label><span>WORKSPACE</span><div><select value={records.selectedId} onChange={(event) => records.select(event.target.value)}><option value="">Direct operations</option>{records.workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><ChevronDown size={14} /></div></label>
          <div><span>WALLET</span><strong>{address ? shortHex(address) : "NOT CONNECTED"}</strong><small>{isConnected ? "READY" : "CONNECT TO AUTHORIZE"}</small></div>
          <div><span>INTERFACE</span><strong>{capabilities?.interfaceVersion ?? (capabilitiesError ? "UNAVAILABLE" : "CHECKING")}</strong><small>VERSIONED BOUNDARY</small></div>
          <div><span>INDEXER</span><strong>{streams.status.toUpperCase()}</strong><small>NON-AUTHORITATIVE READS</small></div>
          <button type="button" onClick={() => void Promise.all([streams.refresh(), records.refresh()])} disabled={streams.refreshing || records.refreshing}><RefreshCw size={14} /> Refresh</button>
        </section>

        {records.runtimeStatus === "loading" && <div className="or-notice"><span>WORKSPACE RUNTIME</span><strong>Discovering saved Workspace records...</strong><small>Reading wallet-authorized state from the versioned Runtime.</small></div>}
        {records.runtimeStatus === "error" && <div className="or-notice"><span>WORKSPACE RUNTIME</span><strong>{records.runtimeError ?? "Workspace discovery failed."}</strong><button type="button" onClick={() => void records.refresh()}>Retry discovery</button></div>}

        <LifecycleRail hasWorkspace={Boolean(workspace)} paths={workspace?.paths.length ?? 0} pacts={workspace?.pacts.length ?? 0} proofs={workspace?.proofs.length ?? 0} payments={workspaceSettlementCount} />

        {!orientationGuide.open && <SetupNavigator steps={setupSteps} open={navigator.open} onOpenChange={navigator.setOpen} onQuickTour={() => orientationGuide.restart()} />}

        <nav className="or-cockpit-tabs" aria-label="App views" data-tour-target="app-views">{views.map((item, index) => <button type="button" className={view === item.id ? "active" : ""} onClick={() => setView(item.id)} key={item.id}><span>0{index + 1}</span><strong>{item.label}</strong><small>{item.description}</small></button>)}<button className="guide" type="button" onClick={() => orientationGuide.restart()}><CircleHelp size={15} /> Quick tour</button></nav>

        {notice && <div className="or-notice"><span>NOTICE</span><strong>{notice}</strong><button type="button" onClick={() => setNotice("")}><X size={14} /></button></div>}

        {view === "workspace" && (workspace ? <><div className={`or-workspace-tour-target ${activeTourTarget === "workspace" ? "or-tour-focus" : ""}`} data-tour-target="workspace"><WorkspaceCanvas workspace={workspace} onNavigate={setView} /><section className="or-workspace-inspector"><div><span>OBJECT STATE</span><strong>{workspace.objectState}</strong></div><div><span>OWNER</span><strong>{shortHex(workspace.owner)}</strong></div><div><span>CREATED</span><strong>{new Date(workspace.createdAt).toLocaleDateString()}</strong></div><div><span>FINANCIAL EFFECT</span><strong>NO VALUE HELD</strong></div><button type="button" onClick={() => setView("authority")}>Manage authority <ArrowRight size={14} /></button></section></div></> : <EmptyWorkspace onInitialize={openWorkspace} />)}

        {view === "authority" && (workspace ? <AuthorityView workspace={workspace} records={records} address={address} onNotice={setNotice} tourActive={activeTourTarget === "authority"} /> : <EmptyWorkspace onInitialize={openWorkspace} />)}

        {view === "payments" && <section className={`or-payment-surface ${activeTourTarget === "payments" ? "or-tour-focus" : ""}`} data-tour-target="payments"><header><div><div className="or-surface-label"><span>PAYMENTS / ARC</span><TermHelp term="Payment context">A direct payment stands on its own. A Workspace payment carries the selected Workspace reference so its authority, terms, Proof, and receipt can be traced together.</TermHelp></div><h2>Choose the context first.</h2><p>Direct payments bind value to the connected wallet and recipient. Workspace-scoped payments additionally bind the payment metadata to the selected operating context.</p></div><div><button type="button" onClick={() => openPayment("direct")}>New direct payment</button><button className="primary" type="button" onClick={() => openPayment("workspace")} disabled={!workspace}>New Workspace payment</button></div></header><div className="or-payment-metrics"><div><span>ACTIVE STREAMS</span><strong>{streams.active.length}</strong></div><div><span>FLOW RATE</span><strong>{fmtUsdcBase(streams.velocityBase)} USDC/s</strong></div><div><span>SETTLED</span><strong>{fmtUsdcBase(streams.settledBase)} USDC</strong></div><div><span>WATCHED VAULTS</span><strong>{streams.vaults.length}</strong></div></div><div className="or-payment-table"><div className="or-table-head"><span>STATE</span><span>RECIPIENT</span><span>ALLOCATION</span><span>RATE</span><span>DURATION</span><span>RECORD</span></div>{streams.status === "loading" && <p>Loading indexed settlement state…</p>}{streams.status === "error" && <p>Indexer unavailable: {streams.errorMsg}</p>}{streams.status === "empty" && <p>No indexed payments yet. Create a direct or Workspace-scoped payment.</p>}{streams.streams.map((stream) => <button type="button" key={`${stream.vaultAddress}:${stream.paycardId}`} onClick={() => setSelectedPayment(`${stream.vaultAddress}:${stream.paycardId}`)}><span><i className={stream.status === "Active" ? "live" : ""} />{stream.status === "Active" ? "STREAMING" : "CLOSED"}</span><strong>{shortHex(stream.recipient)}</strong><strong>{fmtUsdcBase(stream.totalAllocation)} USDC</strong><strong>{fmtUsdcBase(stream.velocity)} USDC/s</strong><strong>{humanDuration(stream.lifespan)}</strong><code>{shortHex(stream.paycardId)}</code></button>)}</div></section>}

        {view === "records" && <section className={`or-record-surface ${activeTourTarget === "records" ? "or-tour-focus" : ""}`} data-tour-target="records"><header><div><div className="or-surface-label"><span>RECORDS / PROJECTION + CANONICAL STATE</span><TermHelp term="Receipt">A receipt is the verifiable result of settlement. It binds the payment reference to the Arc transaction and final Vault state.</TermHelp></div><h2>Trace what cleared.</h2><p>The indexer is a discoverable projection. Vault state and Arc transaction receipts remain canonical.</p></div></header><div className="or-record-ledger">{streams.streams.length ? streams.streams.map((stream, index) => <button type="button" onClick={() => setSelectedPayment(`${stream.vaultAddress}:${stream.paycardId}`)} key={`${stream.vaultAddress}:${stream.paycardId}`}><span>0{index + 1}</span><strong>{stream.status === "Active" ? "PAYMENT STREAMING" : "PAYMENT CLOSED"}</strong><code>{shortHex(stream.vaultAddress)} / {shortHex(stream.paycardId)}</code><small>{fmtUsdcBase(stream.totalAllocation)} USDC</small><b>INSPECT ↗</b></button>) : <p>No settlement records discovered.</p>}</div></section>}

        {view === "activity" && <section className={`or-activity-surface ${activeTourTarget === "activity" ? "or-tour-focus" : ""}`} data-tour-target="activity"><header><div><div className="or-surface-label"><span>ACTIVITY / WORKSPACE + SETTLEMENT</span><TermHelp term="Indexer">The indexer makes Arc events searchable and easier to display. It is a replaceable read model, not the authority for whether funds moved.</TermHelp></div><h2>History without false equivalence.</h2></div></header><div>{workspace?.activity.map((item) => <article key={item.id}><time>{new Date(item.createdAt).toLocaleTimeString()}</time><span>WORKSPACE</span><strong>{item.label}</strong><p>{item.detail}</p><small>{item.state} / {item.financialEffect}</small></article>)}{streams.streams.map((stream) => <article key={`${stream.vaultAddress}:${stream.paycardId}`}><time>{new Date(stream.updatedAt).toLocaleTimeString()}</time><span>ARC INDEXER</span><strong>{stream.status === "Active" ? "Payment streaming" : "Payment closed"}</strong><p>{shortHex(stream.paycardId)} / {fmtUsdcBase(stream.totalAllocation)} USDC</p><small>Non-authoritative projection</small></article>)}{!workspace?.activity.length && !streams.streams.length && <p>No activity recorded.</p>}</div></section>}

        {selectedStream && <aside className="or-payment-inspector"><button type="button" onClick={() => setSelectedPayment("")} aria-label="Close inspector"><X size={15} /></button><span>PAYMENT / INSPECTOR</span><h2>{selectedStream.status === "Active" ? "Streaming" : "Closed"}</h2><p>The indexer found this payment. Verify canonical state against the Vault before relying on it for settlement decisions.</p><dl><div><dt>PAYER</dt><dd>{shortHex(selectedStream.payer)}</dd></div><div><dt>RECIPIENT</dt><dd>{shortHex(selectedStream.recipient)}</dd></div><div><dt>ALLOCATION</dt><dd>{fmtUsdcBase(selectedStream.totalAllocation)} USDC</dd></div><div><dt>AVAILABLE</dt><dd>{fmtUsdcBase(selectedStream.availableBalance)} USDC</dd></div><div><dt>RATE</dt><dd>{fmtUsdcBase(selectedStream.velocity)} USDC/s</dd></div><div><dt>PAYMENT ID</dt><dd>{shortHex(selectedStream.paycardId, 10, 8)}</dd></div><div><dt>VAULT</dt><dd>{shortHex(selectedStream.vaultAddress, 10, 8)}</dd></div></dl><div className="or-binding-chain"><span>VERIFIABLE LIFECYCLE</span><code>CONTEXT → AUTHORIZATION → TERMS → PAYMENT ID → ARC VAULT → RECEIPT</code></div></aside>}
      </main>

      {orientationGuide.open && <FirstRunGuide step={orientationGuide.step} onStep={orientationGuide.setStep} onDismiss={orientationGuide.dismiss} />}
      {!orientationGuide.open && workspace && workspaceGuide.open && <WorkspaceGuide step={workspaceGuide.step} onStep={workspaceGuide.setStep} onDismiss={workspaceGuide.dismiss} onSelect={setView} onOverview={restartOverview} />}
      {workspaceModal && <WorkspaceInitialization owner={address} onClose={() => setWorkspaceModal(false)} onInitialize={async (name) => { try { await records.initialize(name, address!); setWorkspaceModal(false); setView("workspace"); } catch (error) { setNotice(error instanceof Error ? error.message : "Workspace initialization failed."); } }} />}
      <NewPaymentModal open={paymentModal} onClose={() => setPaymentModal(false)} hub={HUB} usdc={USDC} workspace={workspace ? { id: workspace.id, name: workspace.name } : null} initialContext={paymentContext} onSuccess={(paycardId) => { if (paymentContext === "workspace" && workspace) records.recordPayment(paycardId); setNotice(`Payment ${shortHex(paycardId)} submitted. Waiting for indexer discovery.`); setPaymentModal(false); setView("payments"); streams.refresh(); }} onCircleSuccess={(result: CircleSettlementResult) => { if (paymentContext === "workspace" && workspace) records.recordPayment(result.paycardId); setNotice(`Sponsored payment ${shortHex(result.paycardId)} confirmed and verified.`); setPaymentModal(false); setView("payments"); streams.refresh(); }} />
    </ProductShell>
  );
}
