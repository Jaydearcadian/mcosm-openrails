import { useMemo } from "react";
import { ArrowRight } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { ProductShell } from "../gasok/components/ProductShell";
import { toUsdc, fmtUsd, shortHex } from "../lib/api";
import { parseOpenRailsLink, type OpenRailsLinkArtifact, type RailsCardLinkPayload, type RailsFlowLinkPayload } from "../lib/links";
import { deserializeEnvelope, type CryptographicEnvelopeV1 } from "../lib/intents";
import { useRailsActions } from "../lib/useRailsActions";
import { useWalletConnection } from "../lib/useWalletConnection";
import "../gasok/styles.css";
import "../gasok/product.css";

function velocityPerHour(basePerSecond: string | number) { return ((Number(basePerSecond) / 1e6) * 3600).toFixed(4); }
function duration(seconds: number) {
  if (!isFinite(seconds) || seconds <= 0) return "IMMEDIATE";
  if (seconds >= 86400) return `${(seconds / 86400).toFixed(seconds % 86400 ? 1 : 0)} DAYS`;
  if (seconds >= 3600) return `${(seconds / 3600).toFixed(seconds % 3600 ? 1 : 0)} HOURS`;
  if (seconds >= 60) return `${(seconds / 60).toFixed(seconds % 60 ? 1 : 0)} MINUTES`;
  return `${seconds} SECONDS`;
}

type Terms = { kind: OpenRailsLinkArtifact["kind"]; title: string; valueUsdc: number; velocityHour: string; lifespanSeconds: number; instant: boolean; counterpartyLabel: string; counterparty: string; note: string };

function termsFor(artifact: OpenRailsLinkArtifact): Terms {
  if (artifact.kind === "railscard") {
    const payload = artifact.payload as RailsCardLinkPayload;
    const envelope = deserializeEnvelope<CryptographicEnvelopeV1>(payload.envelopeToken);
    const metadata = envelope.metadata;
    const lifespanSeconds = Number(metadata?.lifespanSeconds ?? envelope.intent.lifespanSeconds);
    return { kind: "railscard", title: payload.mode === "railscard_recipient_bound" ? "Recipient-bound claim" : "Claimable payment", valueUsdc: toUsdc(metadata?.amount ?? envelope.intent.totalAllocationPool), velocityHour: velocityPerHour(metadata?.flowVelocityPerSecond ?? envelope.intent.flowVelocityPerSecond), lifespanSeconds, instant: lifespanSeconds === 0, counterpartyLabel: "PAYER", counterparty: envelope.payerAddress, note: payload.mode === "railscard_recipient_bound" ? "This signed value can only be claimed by its named recipient." : "The first valid claimant binds this payment. Treat the unclaimed link as sensitive." };
  }
  const payload = artifact.payload as RailsFlowLinkPayload;
  return { kind: "railsflow", title: "Payment request", valueUsdc: toUsdc(payload.amount), velocityHour: velocityPerHour(payload.flowVelocityPerSecond), lifespanSeconds: payload.lifespanSeconds, instant: payload.lifespanSeconds === 0, counterpartyLabel: "RECIPIENT", counterparty: payload.recipient, note: "Review the exact terms before authorizing. Sponsored execution pays Arc gas, while payment value still comes from your wallet." };
}

export default function LinkLanding() {
  const location = useLocation();
  const { isConnected, address } = useWalletConnection();
  const { config, status, busy, act, claimRailsCard, claimRailsCardSponsored, payRailsFlowSponsored, reset } = useRailsActions();
  const parsed = useMemo(() => {
    try { const artifact = parseOpenRailsLink(window.location.href); return { artifact, terms: termsFor(artifact), error: "" }; }
    catch (error) { return { artifact: null, terms: null, error: error instanceof Error ? error.message : String(error) }; }
  }, [location.hash]);
  const explorer = config?.explorerBaseUrl ?? "https://testnet.arcscan.app";

  return <ProductShell><main className="or-link-page"><section className="or-link-context"><span>OPENRAILS / SIGNED PAYMENT</span><h1>Inspect before<br /><b>you authorize.</b></h1><p>Payment links carry exact value and settlement terms. The wallet authorizes. Arc provides canonical execution evidence.</p></section>{parsed.error || !parsed.artifact || !parsed.terms ? <section className="or-link-card"><span>INVALID PAYMENT LINK</span><h2>This link could not be read.</h2><p>{parsed.error || "The signed payment artifact is missing or invalid."}</p><Link to="/app">Open Cockpit <ArrowRight size={14} /></Link></section> : <section className="or-link-card"><header><div><span>{parsed.terms.kind === "railscard" ? "CLAIM LINK" : "PAYMENT REQUEST"}</span><h2>{parsed.terms.title}</h2></div><strong>{parsed.terms.instant ? "ONE-TIME" : "STREAMING"}</strong></header><div className="or-link-value"><span>AUTHORIZED VALUE</span><strong>{fmtUsd(parsed.terms.valueUsdc)}</strong><small>USDC</small></div><dl><div><dt>SETTLEMENT</dt><dd>{parsed.terms.instant ? "IN FULL" : `${parsed.terms.velocityHour} USDC / HOUR`}</dd></div><div><dt>DURATION</dt><dd>{duration(parsed.terms.lifespanSeconds)}</dd></div><div><dt>{parsed.terms.counterpartyLabel}</dt><dd>{shortHex(parsed.terms.counterparty, 8, 6)}</dd></div><div><dt>EXECUTION</dt><dd>ARC TESTNET</dd></div></dl><p className="or-link-note">{parsed.terms.note}</p>{status.id === "success" ? <div className="or-link-success"><span>ARC / CONFIRMED</span><strong>{parsed.terms.kind === "railscard" ? "Payment claimed" : "Payment opened"}</strong><a href={`${explorer}/tx/${status.txHash}`} target="_blank" rel="noreferrer">Inspect transaction ↗</a></div> : !isConnected ? <div className="or-link-connect"><span>CONNECT FROM THE CONTROL STRIP TO CONTINUE</span><p>No payment value moves before wallet authorization.</p></div> : <div className="or-link-actions"><span>CONNECTED / {shortHex(address ?? "", 8, 6)}</span><button className="primary" type="button" disabled={busy || !config} onClick={() => parsed.terms!.kind === "railscard" ? claimRailsCardSponsored(parsed.artifact!) : payRailsFlowSponsored(parsed.artifact!)}>{status.id === "approving" ? "APPROVING USDC" : status.id === "signing" ? "AWAITING SIGNATURE" : status.id === "submitting" ? "SUBMITTING TO ARC" : parsed.terms.kind === "railscard" ? "CLAIM / GAS SPONSORED" : "PAY / GAS SPONSORED"} <ArrowRight size={14} /></button>{!busy && <button type="button" disabled={!config} onClick={() => parsed.terms!.kind === "railscard" ? claimRailsCard(parsed.artifact!) : act(parsed.artifact!)}>Self-submit and pay Arc gas</button>}{status.id === "error" && <div className="or-payment-error">{status.msg} <button type="button" onClick={reset}>Try again</button></div>}</div>}</section>}</main></ProductShell>;
}
