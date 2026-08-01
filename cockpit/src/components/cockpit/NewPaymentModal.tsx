import { Component, useEffect, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { QRCodeSVG } from "qrcode.react";
import { PrimaryButton, SecondaryButton, TextInput, FieldLabel } from "./Panel";
import { useNewPayment, type NewPaymentMode, type NewPaymentCardVariant, type NewPaymentType } from "../../lib/newPayment";

class QRBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{ width: 132, height: 132, display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", fontFamily: "'JetBrains Mono', monospace", fontSize: 10, lineHeight: 1.5, color: "rgba(11,17,32,0.5)", background: "rgba(11,17,32,0.04)", border: "1px dashed rgba(11,17,32,0.15)", borderRadius: 8, padding: 8 }}>
          Link is too long for a QR code. Use Copy or Share.
        </div>
      );
    }
    return this.props.children;
  }
}

function SegButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        fontFamily: "Inter, sans-serif",
        fontSize: 12.5,
        fontWeight: 600,
        color: active ? "#00794A" : "rgba(11,17,32,0.55)",
        background: active ? "rgba(0,158,96,0.14)" : "transparent",
        border: active ? "1px solid rgba(0,158,96,0.3)" : "1px solid transparent",
        borderRadius: 9,
        padding: "8px 10px",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

export function NewPaymentModal({
  open,
  onClose,
  hub,
  usdc,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  hub: string;
  usdc: string;
  onSuccess: (paycardId: string) => void;
}) {
  const { isConnected } = useAccount();
  const { status, busy, submit, generateLink, reset } = useNewPayment(hub, usdc);

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

  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable — no-op */
    }
  }

  async function handleShare() {
    try {
      await navigator.share({ url: link, title: "OpenRails payment link", text: "Open this OpenRails link to pay or claim." });
    } catch {
      /* user cancelled or share failed — no-op */
    }
  }

  useEffect(() => {
    if (open) {
      reset();
      setLink("");
      setLinkError("");
      setCopied(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (status.id === "success") onSuccess(status.paycardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  if (!open) return null;

  const isCard = mode === "railscard";
  const isBearer = isCard && cardVariant === "bearer";
  const partyRequired = mode === "railsflow" || (isCard && cardVariant === "bound");
  const params = { mode, cardVariant, type, party, amountUsdc: amount, velocityUsdcPerSec: velocity, lifespanSeconds: lifespan, memo };

  async function handleGenerateLink() {
    setLinkError("");
    try {
      const url = await generateLink(params);
      setLink(url);
    } catch (e) {
      setLinkError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(4,7,13,0.5)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 560, maxHeight: "88vh", overflow: "auto", background: "#FBFCFE", border: "1px solid rgba(11,17,32,0.1)", borderRadius: 20, boxShadow: "0 30px 80px rgba(4,7,13,0.4)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px 16px", borderBottom: "1px solid rgba(11,17,32,0.07)" }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>New payment</h3>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, color: "rgba(11,17,32,0.45)", marginTop: 3 }}>
              {mode === "railsflow" ? "RailsFlow · request link" : `RailsCard · ${cardVariant === "bearer" ? "bearer" : "recipient-bound"}`}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 8, border: "1px solid rgba(11,17,32,0.12)", background: "rgba(255,255,255,0.7)", color: "rgba(11,17,32,0.55)", fontSize: 16, cursor: "pointer" }}>
            ✕
          </button>
        </div>

        <div style={{ padding: "20px 24px 8px" }}>
          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(11,17,32,0.42)", marginBottom: 9 }}>Primitive</div>
          <div style={{ display: "flex", gap: 8, background: "rgba(11,17,32,0.045)", border: "1px solid rgba(11,17,32,0.07)", borderRadius: 12, padding: 5 }}>
            <SegButton active={mode === "railsflow"} onClick={() => setMode("railsflow")}>RailsFlow</SegButton>
            <SegButton active={mode === "railscard"} onClick={() => setMode("railscard")}>RailsCard</SegButton>
          </div>
          <div style={{ marginTop: 8, fontSize: 12.5, lineHeight: 1.55, color: "rgba(11,17,32,0.55)" }}>
            {mode === "railsflow"
              ? "A request link — whoever opens it becomes the payer and signs."
              : "A payer-signed value link, pre-authorized for a later claim."}
          </div>

          {isCard && (
            <div style={{ marginTop: 14, marginLeft: 14, padding: "14px 16px", borderLeft: "2px solid rgba(0,158,96,0.35)", background: "rgba(0,158,96,0.04)", borderRadius: "0 12px 12px 0" }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(11,17,32,0.42)", marginBottom: 9 }}>Claimability</div>
              <div style={{ display: "flex", gap: 8, background: "rgba(255,255,255,0.6)", border: "1px solid rgba(11,17,32,0.07)", borderRadius: 10, padding: 4 }}>
                <SegButton active={cardVariant === "bearer"} onClick={() => setCardVariant("bearer")}>Bearer</SegButton>
                <SegButton active={cardVariant === "bound"} onClick={() => setCardVariant("bound")}>Recipient-Bound</SegButton>
              </div>
              <div style={{ marginTop: 9, fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, lineHeight: 1.5, color: "rgba(11,17,32,0.5)" }}>
                {cardVariant === "bearer"
                  ? "First valid claimant binds — treat the unclaimed link as sensitive."
                  : "Locked to one specific address at signing time."}
              </div>
            </div>
          )}

          <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(11,17,32,0.42)", margin: "18px 0 9px" }}>Type</div>
          <div style={{ display: "flex", gap: 8, background: "rgba(11,17,32,0.045)", border: "1px solid rgba(11,17,32,0.07)", borderRadius: 12, padding: 5 }}>
            <SegButton active={type === "one-time"} onClick={() => setType("one-time")}>One-time</SegButton>
            <SegButton active={type === "streaming"} onClick={() => setType("streaming")}>Streaming</SegButton>
          </div>

          <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 18 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <FieldLabel>{isBearer ? "Claimer Address" : "Recipient Address"}</FieldLabel>
              {partyRequired ? (
                <span style={{ color: "#C73A3A", fontSize: 10.5 }}>required</span>
              ) : (
                <span style={{ color: "rgba(11,17,32,0.4)", fontSize: 10.5 }}>optional</span>
              )}
            </span>
            <TextInput value={party} onChange={(e) => setParty(e.target.value)} placeholder="0x… address" />
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 14 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <FieldLabel>Amount (USDC)</FieldLabel>
              <TextInput type="number" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" />
            </label>
            {type === "streaming" && (
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <FieldLabel>Velocity (USDC/s)</FieldLabel>
                <TextInput type="number" min="0" value={velocity} onChange={(e) => setVelocity(e.target.value)} placeholder="0.10" />
              </label>
            )}
          </div>
          {type === "streaming" && (
            <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
              <FieldLabel>Lifespan (seconds)</FieldLabel>
              <TextInput type="number" min="0" value={lifespan} onChange={(e) => setLifespan(e.target.value)} placeholder="3600" />
            </label>
          )}
          <label style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 14 }}>
            <FieldLabel>Memo (optional)</FieldLabel>
            <TextInput value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="e.g. Invoice #1042" />
          </label>

          {link && (
            <div style={{ marginTop: 14, background: "rgba(0,158,96,0.06)", border: "1px solid rgba(0,158,96,0.25)", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                <div style={{ flex: "0 0 auto", background: "#FFFFFF", border: "1px solid rgba(11,17,32,0.1)", borderRadius: 12, padding: 10, lineHeight: 0 }}>
                  <QRBoundary key={link}>
                    <QRCodeSVG value={link} size={132} level="L" marginSize={0} />
                  </QRBoundary>
                </div>
                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 9.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(11,17,32,0.42)" }}>
                    Shareable link
                  </div>
                  {/* Displayed text is visually truncated (max-height + break) — copy/share/QR use the FULL untruncated `link`. */}
                  <div
                    style={{
                      fontFamily: "'JetBrains Mono', monospace",
                      fontSize: 11,
                      lineHeight: 1.55,
                      color: "#0B1120",
                      wordBreak: "break-all",
                      overflow: "hidden",
                      maxHeight: 68,
                      maskImage: "linear-gradient(180deg, #000 62%, transparent 100%)",
                      WebkitMaskImage: "linear-gradient(180deg, #000 62%, transparent 100%)",
                      background: "rgba(255,255,255,0.6)",
                      border: "1px solid rgba(11,17,32,0.08)",
                      borderRadius: 8,
                      padding: "9px 11px",
                    }}
                  >
                    {link}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={handleCopy}
                      style={{
                        fontFamily: "'JetBrains Mono', monospace",
                        fontSize: 11,
                        fontWeight: 600,
                        color: copied ? "#00794A" : "rgba(11,17,32,0.7)",
                        background: copied ? "rgba(0,158,96,0.14)" : "rgba(255,255,255,0.75)",
                        border: `1px solid ${copied ? "rgba(0,158,96,0.35)" : "rgba(11,17,32,0.16)"}`,
                        borderRadius: 999,
                        padding: "7px 14px",
                        cursor: "pointer",
                      }}
                    >
                      {copied ? "Copied ✓" : "Copy link"}
                    </button>
                    {canShare && (
                      <button
                        type="button"
                        onClick={handleShare}
                        style={{
                          fontFamily: "'JetBrains Mono', monospace",
                          fontSize: 11,
                          fontWeight: 600,
                          color: "rgba(11,17,32,0.7)",
                          background: "rgba(255,255,255,0.75)",
                          border: "1px solid rgba(11,17,32,0.16)",
                          borderRadius: 999,
                          padding: "7px 14px",
                          cursor: "pointer",
                        }}
                      >
                        Share…
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
          {linkError && <p style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#C73A3A" }}>{linkError}</p>}
          {status.id === "error" && <p style={{ marginTop: 10, fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "#C73A3A" }}>{status.msg}</p>}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "16px 24px", borderTop: "1px solid rgba(11,17,32,0.07)" }}>
          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 10, color: "rgba(11,17,32,0.42)" }}>
              {!isConnected ? "Connect a wallet first" : busy ? statusLabel(status) : ""}
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <SecondaryButton onClick={handleGenerateLink} disabled={busy || (!isConnected && mode !== "railsflow")}>
                {busy
                  ? statusLabel(status)
                  : mode === "railscard"
                    ? "Authorize & generate"
                    : "Generate request"}
              </SecondaryButton>
              <PrimaryButton onClick={() => submit(params, "gasless")} disabled={busy || !isConnected || isBearer}>
                {busy ? statusLabel(status) : "Pay · gas sponsored"}
              </PrimaryButton>
            </div>
          </div>
          {!busy && isConnected && !isBearer && (
            <button
              type="button"
              onClick={() => submit(params, "self-submit")}
              style={{ alignSelf: "flex-end", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "'JetBrains Mono', monospace", fontSize: 11, color: "rgba(11,17,32,0.42)", textDecoration: "underline" }}
            >
              or self-submit (you pay gas)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function statusLabel(status: { id: string }): string {
  if (status.id === "checking") return "Checking funding...";
  if (status.id === "approving") return "Approving USDC…";
  if (status.id === "signing") return "Sign in your wallet…";
  if (status.id === "submitting") return "Submitting…";
  return "";
}
