import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowRight, Copy, Share2, X } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useNewPayment, type NewPaymentCardVariant, type NewPaymentMode, type NewPaymentType } from "../../lib/newPayment";
import { truncateMiddle } from "../../lib/cockpitFormat";
import { useWalletConnection } from "../../lib/useWalletConnection";
import { useCircleModularWallet } from "../../lib/circleModularWallet";
import { circleSettlementStatusLabel, useCircleSettlement, type CircleSettlementResult } from "../../lib/circleSettlement";
import { CirclePasskeyButton } from "../CirclePasskeyButton";

class QRBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) return <div className="or-qr-fallback">Link exceeds QR capacity. Use Copy or Share.</div>;
    return this.props.children;
  }
}

function Segment({ active, children, onClick, disabled }: { active: boolean; children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className={active ? "active" : ""} onClick={onClick} disabled={disabled}>{children}</button>;
}

function statusLabel(status: { id: string }) {
  if (status.id === "approving") return "Approving USDC";
  if (status.id === "signing") return "Awaiting wallet signature";
  if (status.id === "submitting") return "Submitting to Arc";
  return "";
}

export function NewPaymentModal({ open, onClose, hub, usdc, workspace, initialContext = "direct", onSuccess, onCircleSuccess }: {
  open: boolean;
  onClose: () => void;
  hub: string;
  usdc: string;
  workspace?: { id: string; name: string } | null;
  initialContext?: "direct" | "workspace";
  onSuccess: (paycardId: string) => void;
  onCircleSuccess?: (result: CircleSettlementResult) => void;
}) {
  const { isConnected } = useWalletConnection();
  const { status, busy, balanceLoading, submit, generateLink, reset } = useNewPayment(hub, usdc);
  const { config: circleConfig, wallet: circleWallet } = useCircleModularWallet();
  const { status: circleStatus, busy: circleBusy, execute: executeCircleSettlement, reset: resetCircleSettlement } = useCircleSettlement();
  const [context, setContext] = useState<"direct" | "workspace">("direct");
  const [mode, setMode] = useState<NewPaymentMode>("railsflow");
  const [cardVariant, setCardVariant] = useState<NewPaymentCardVariant>("bearer");
  const [type, setType] = useState<NewPaymentType>("streaming");
  const [party, setParty] = useState("");
  const [amount, setAmount] = useState("25");
  const [velocity, setVelocity] = useState("0.10");
  const [lifespan, setLifespan] = useState("3600");
  const [memo, setMemo] = useState("");
  const [link, setLink] = useState("");
  const [linkError, setLinkError] = useState("");
  const [copied, setCopied] = useState(false);
  const onSuccessRef = useRef(onSuccess);
  const onCircleSuccessRef = useRef(onCircleSuccess);
  const checkingBalance = isConnected && balanceLoading;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  useEffect(() => {
    onSuccessRef.current = onSuccess;
    onCircleSuccessRef.current = onCircleSuccess;
  }, [onCircleSuccess, onSuccess]);

  useEffect(() => {
    if (!open) return;
    reset();
    resetCircleSettlement();
    setContext(initialContext === "workspace" && workspace ? "workspace" : "direct");
    setLink("");
    setLinkError("");
    setCopied(false);
  }, [initialContext, open, reset, resetCircleSettlement, workspace?.id]);

  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy && !circleBusy) onClose(); };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [busy, circleBusy, onClose, open]);

  useEffect(() => {
    if (status.id === "success") onSuccessRef.current(status.paycardId);
  }, [status]);

  useEffect(() => {
    if (circleStatus.id !== "confirmed") return;
    const result: CircleSettlementResult = { userOpHash: circleStatus.userOpHash as `0x${string}`, txHash: circleStatus.txHash as `0x${string}`, paycardId: circleStatus.paycardId, payer: circleStatus.payer, receiptVerified: true, vaultVerified: true };
    if (onCircleSuccessRef.current) onCircleSuccessRef.current(result); else onSuccessRef.current(result.paycardId);
  }, [circleStatus]);

  useEffect(() => {
    setLink("");
    setLinkError("");
    setCopied(false);
  }, [context, mode, cardVariant, type, party, amount, velocity, lifespan, memo]);

  if (!open) return null;
  const isCard = mode === "railscard";
  const isBearer = isCard && cardVariant === "bearer";
  const partyRequired = mode === "railsflow" || (isCard && cardVariant === "bound");
  const params = { mode, cardVariant, type, party, amountUsdc: amount, velocityUsdcPerSec: velocity, lifespanSeconds: lifespan, memo, workflowId: context === "workspace" ? workspace?.id : undefined };

  async function makeLink() {
    setLinkError("");
    try { setLink(await generateLink(params)); }
    catch (error) { setLinkError(error instanceof Error ? error.message : String(error)); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(link); setCopied(true); window.setTimeout(() => setCopied(false), 1400); } catch { setCopied(false); }
  }

  async function shareLink() {
    try { await navigator.share({ url: link, title: "OpenRails payment", text: "Review this OpenRails payment." }); } catch { /* user cancelled */ }
  }

  async function payWithCircle() {
    await executeCircleSettlement({ hubAddress: hub, usdcAddress: usdc, recipient: party, amountUsdc: amount, type, velocityUsdcPerSec: velocity, lifespanSeconds: lifespan, memo, workflowId: context === "workspace" ? workspace?.id : undefined });
  }

  const executionStatus = busy ? statusLabel(status) : circleBusy ? circleSettlementStatusLabel(circleStatus) : checkingBalance ? "Checking USDC balance" : "";

  return <div className="or-modal-backdrop" onMouseDown={onClose}><section className="or-modal or-payment-modal" role="dialog" aria-modal="true" aria-labelledby="payment-title" onMouseDown={(event) => event.stopPropagation()}><header><div><span>PAYMENT / COMPOSE</span><h2 id="payment-title">Move value with explicit terms.</h2></div><button type="button" onClick={onClose} aria-label="Close"><X size={16} /></button></header><form onSubmit={(event) => event.preventDefault()}>
    <div className="or-segment-label">CONTEXT</div><div className="or-segments"><Segment active={context === "direct"} onClick={() => setContext("direct")}>DIRECT</Segment><Segment active={context === "workspace"} onClick={() => setContext("workspace")} disabled={!workspace}>WORKSPACE-SCOPED</Segment></div><p className="or-segment-help">{context === "workspace" ? `Payment metadata will reference ${workspace?.name} / ${workspace?.id}.` : "The connected wallet authorizes value directly. No Workspace is required."}</p>
    <div className="or-segment-label">PAYMENT ACTION</div><div className="or-segments"><Segment active={mode === "railsflow"} onClick={() => setMode("railsflow")}>PAY A RECIPIENT</Segment><Segment active={mode === "railscard"} onClick={() => setMode("railscard")}>CREATE CLAIM LINK</Segment></div><p className="or-segment-help">{mode === "railsflow" ? "Settle to a named recipient now, once or over time." : "Authorize claimable value and share the resulting link."}</p>
    {isCard && <><div className="or-segment-label">CLAIM POLICY</div><div className="or-segments"><Segment active={cardVariant === "bearer"} onClick={() => setCardVariant("bearer")}>ANYONE WITH LINK</Segment><Segment active={cardVariant === "bound"} onClick={() => setCardVariant("bound")}>NAMED RECIPIENT</Segment></div><p className="or-segment-help">{isBearer ? "The first valid claimant binds the payment. Treat the unclaimed link as sensitive." : "Only the address signed into the payment may claim it."}</p></>}
    <div className="or-segment-label">SETTLEMENT SHAPE</div><div className="or-segments"><Segment active={type === "one-time"} onClick={() => setType("one-time")}>ONE-TIME</Segment><Segment active={type === "streaming"} onClick={() => setType("streaming")}>STREAMING</Segment></div>
    <div className="or-payment-fields"><label className="wide"><span>{isBearer ? "OPTIONAL CLAIM HINT" : "RECIPIENT ADDRESS"}{partyRequired ? " / REQUIRED" : ""}</span><input data-testid="payment-recipient" value={party} onChange={(event) => setParty(event.target.value)} placeholder="0x..." /></label><label><span>ALLOCATION / USDC</span><input data-testid="payment-amount" type="number" min="0" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>{type === "streaming" && <label><span>RATE / USDC PER SECOND</span><input data-testid="payment-velocity" type="number" min="0" value={velocity} onChange={(event) => setVelocity(event.target.value)} /></label>}{type === "streaming" && <label><span>DURATION / SECONDS</span><input data-testid="payment-lifespan" type="number" min="0" value={lifespan} onChange={(event) => setLifespan(event.target.value)} /></label>}<label className={type === "one-time" ? "wide" : ""}><span>MEMO / OPTIONAL</span><input value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="Invoice, service, or commercial reference" /></label></div>
    <div className="or-payment-summary"><div><span>CONTEXT</span><strong>{context === "workspace" ? "WORKSPACE" : "DIRECT"}</strong></div><div><span>AUTHORITY</span><strong>CONNECTED WALLET</strong></div><div><span>VALUE EFFECT</span><strong>{isBearer ? "ON CLAIM" : "ON SUBMIT"}</strong></div><div><span>FINALITY</span><strong>ARC RECEIPT</strong></div></div>
    {link && <div className="or-payment-link"><div className="or-payment-link-qr"><QRBoundary key={link}><QRCodeSVG value={link} size={132} level="L" marginSize={0} /></QRBoundary></div><div><div className="or-segment-label">SIGNED PAYMENT LINK</div><code>{truncateMiddle(link)}</code><div className="or-payment-link-actions"><button type="button" onClick={copyLink}><Copy size={13} /> {copied ? "COPIED" : "COPY"}</button>{canShare && <button type="button" onClick={shareLink}><Share2 size={13} /> SHARE</button>}</div></div></div>}
    {linkError && <div className="or-payment-error">{linkError}</div>}{status.id === "error" && <div className="or-payment-error">{status.msg}</div>}{executionStatus && <div className="or-payment-warning">{executionStatus}</div>}
    {mode === "railsflow" && <div className="or-payment-success"><strong>CIRCLE GAS STATION</strong><p>{circleStatus.id !== "idle" ? circleSettlementStatusLabel(circleStatus) : circleWallet ? `Passkey account ${circleWallet.address.slice(0, 6)}...${circleWallet.address.slice(-4)} is ready.` : circleConfig.id === "ready" ? "Create or unlock a Circle passkey to use sponsored smart-account execution." : circleConfig.reason}</p><div className="or-circle-payment-actions"><CirclePasskeyButton /><button type="button" data-testid="circle-settlement-submit" onClick={payWithCircle} disabled={circleBusy || busy || checkingBalance || !party || circleConfig.id !== "ready" || !circleWallet}>{circleBusy ? "PROCESSING" : "PAY WITH CIRCLE PASSKEY"}</button></div></div>}
    <footer><button type="button" onClick={makeLink} disabled={busy || circleBusy || (!isConnected && mode !== "railsflow") || checkingBalance}>{mode === "railscard" ? "AUTHORIZE + GENERATE LINK" : "GENERATE REQUEST"}</button><button type="button" className="primary" onClick={() => submit(params, "gasless")} disabled={busy || circleBusy || !isConnected || isBearer || checkingBalance}>PAY / GAS SPONSORED <ArrowRight size={14} /></button></footer>{isConnected && !isBearer && !busy && !circleBusy && !checkingBalance && <button className="or-self-submit" type="button" onClick={() => submit(params, "self-submit")}>Self-submit and pay Arc gas</button>}
  </form></section></div>;
}
