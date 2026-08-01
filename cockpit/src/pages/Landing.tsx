/**
 * Landing — OpenRails marketing homepage.
 *
 * Ported 1:1 from the approved Claude Design prototype ("OpenRails Landing.dc.html",
 * a DCLogic `sc-if`/`sc-for`/`{{ }}` template). Pixel-faithful: every color, gradient,
 * blur amount, border-radius, spacing, typography and animation matches the source as
 * authored. Inline `style="…"` strings became React `style={{…}}` objects; `style-hover`
 * attributes map to scoped `.or-*:hover` classes in index.css; `data-anim` CSS animations
 * and the `or-*` keyframes live in index.css; the hero demo + scroll-reveal are ported
 * imperatively (querying `data-or-ref` / `data-reveal`, exactly like the source's
 * observer-free implementation) so no React re-render fights the DOM mutation.
 *
 * <image-slot> elements are rendered as background-image <div>s pointing at
 * /assets/*.png — a missing file simply renders no texture (no broken-image icon), and
 * the real art appears automatically once PNGs are dropped into public/assets/.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import "./Landing.css";

const MONO = "'JetBrains Mono', monospace";

/** Simulated hero demo flow rate (marketing-visual flavor only — NOT on-chain data). */
const FLOW_RATE = 0.38;

/** <image-slot> port: absolute-positioned background image div. */
function ImageSlot({ src, opacity }: { src: string; opacity?: number }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        backgroundImage: `url(/assets/${src})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        pointerEvents: "none",
        ...(opacity != null ? { opacity } : {}),
      }}
    />
  );
}

/** OpenRails logo mark: dark rounded square with the real chrome "OR" monogram. */
function LogoMark({ size, radius }: { size: number; radius: number }) {
  return (
    <span
      style={{
        display: "grid",
        placeItems: "center",
        width: size,
        height: size,
        borderRadius: radius,
        background: "#0B0B0C",
        overflow: "hidden",
        boxShadow:
          size >= 34
            ? "0 4px 14px rgba(4,7,13,0.28), inset 0 1px 0 rgba(255,255,255,0.14)"
            : undefined,
      }}
    >
      <img
        src="/assets/or-logo.jpg"
        alt="OpenRails"
        style={{ width: "100%", height: "100%", objectFit: "cover", transform: "scale(1.32)", display: "block" }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    </span>
  );
}

const AUDIENCES = [
  {
    tag: "People",
    title: "A tab that closes itself",
    body: "Send or request money that settles as it’s used, and refunds the rest. A link is the whole interface.",
    meta: "split · request · gift",
    delay: 0,
  },
  {
    tag: "AI agents",
    title: "A budget it can’t exceed",
    body: "Hand an agent a bounded budget it can spend on its own: pay-per-task, provably capped, unused portion swept back.",
    meta: "MCP · nonce lanes · gasless",
    delay: 100,
  },
  {
    tag: "Businesses",
    title: "Billing without reconciliation",
    body: "Bill for what customers actually use, in real time, with a verifiable receipt for every cent.",
    meta: "metered · chargeback-free",
    delay: 200,
  },
  {
    tag: "Creators",
    title: "Paid the moment it plays",
    body: "Get paid per stream, per play, per view, the moment it happens, straight from your audience.",
    meta: "per play · no distributor skim",
    delay: 300,
  },
];

/** Shared frosted card styles used across the hero satellite cards. */
const frostCard: CSSProperties = {
  background: "rgba(255,255,255,0.72)",
  backdropFilter: "blur(20px) saturate(160%)",
  WebkitBackdropFilter: "blur(20px) saturate(160%)",
  border: "1px solid rgba(11,17,32,0.08)",
  borderRadius: 18,
  padding: "18px 20px",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 14px 34px rgba(11,17,32,0.10)",
};

const eyebrowPill: CSSProperties = {
  display: "inline-block",
  fontFamily: MONO,
  fontSize: 11,
  letterSpacing: "0.2em",
  textTransform: "uppercase",
  color: "rgba(11,17,32,0.5)",
  border: "1px solid rgba(11,17,32,0.12)",
  borderRadius: 999,
  padding: "7px 16px",
  background: "rgba(255,255,255,0.6)",
};

const sectionH2: CSSProperties = {
  fontSize: "clamp(32px, 3.6vw, 48px)",
  lineHeight: 1.1,
  letterSpacing: "-0.03em",
  fontWeight: 700,
  textWrap: "balance" as CSSProperties["textWrap"],
};

const marqueeGroup: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 38,
  paddingRight: 38,
  fontFamily: MONO,
  fontSize: 12,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  color: "rgba(11,17,32,0.55)",
  whiteSpace: "nowrap",
};

const lifecycleDash: CSSProperties = {
  width: 34,
  height: 1,
  background: "linear-gradient(90deg, rgba(11,17,32,0.25), rgba(11,17,32,0.08))",
};
const lifecyclePill: CSSProperties = {
  padding: "7px 16px",
  border: "1px solid rgba(11,17,32,0.12)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.6)",
};

function MarqueeContent() {
  return (
    <div style={marqueeGroup}>
      <span>Sign a bounded intent</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Value streams as it's earned</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Unused funds return to you</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Every cent leaves a receipt</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Sign a bounded intent</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Value streams as it's earned</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Unused funds return to you</span><span style={{ color: "#009E60" }}>◆</span>
      <span>Every cent leaves a receipt</span><span style={{ color: "#009E60" }}>◆</span>
    </div>
  );
}

export default function Landing() {
  const rootRef = useRef<HTMLDivElement>(null);

  // ── Mobile nav: matchMedia-driven breakpoint + hamburger dropdown state ──
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches,
  );
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => {
      setIsMobile(mq.matches);
      if (!mq.matches) setMenuOpen(false);
    };
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // ── Scroll-reveal: observer-free port of setupReveals() ──
  useEffect(() => {
    const ease = "cubic-bezier(0.22, 1, 0.36, 1)";
    let revealTimer: ReturnType<typeof setInterval> | undefined;
    let finalTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).forEach((n) => {
        if (n.getBoundingClientRect().top > window.innerHeight * 0.92) {
          n.dataset.orHidden = "1";
          n.style.transition = "opacity 0.9s " + ease + ", transform 0.9s " + ease;
          n.style.opacity = "0";
          n.style.transform = (n.style.transform ? n.style.transform + " " : "") + "translateY(26px)";
        }
      });
    } catch {
      /* never block rendering */
    }

    const check = () => {
      try {
        const pending = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).filter(
          (n) => n.dataset.orHidden === "1",
        );
        if (!pending.length) return;
        pending.forEach((n) => {
          const r = n.getBoundingClientRect();
          if (r.top < window.innerHeight * 0.92 || r.bottom < 0) {
            n.dataset.orHidden = "0";
            const delay = parseInt(n.getAttribute("data-reveal") || "0", 10);
            setTimeout(() => {
              n.style.opacity = "1";
              n.style.transform = (n.style.transform || "").replace(/ ?translateY\(26px\)/, "");
            }, delay);
          }
        });
      } catch {
        /* ignore */
      }
    };

    window.addEventListener("scroll", check, { passive: true });
    revealTimer = setInterval(check, 350);
    finalTimer = setTimeout(() => {
      try {
        Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]")).forEach((n) => {
          if (n.dataset.orHidden === "1") {
            n.dataset.orHidden = "0";
            n.style.opacity = "1";
            n.style.transform = (n.style.transform || "").replace(/ ?translateY\(26px\)/, "");
          }
        });
      } catch {
        /* ignore */
      }
    }, 15000);
    check();

    return () => {
      window.removeEventListener("scroll", check);
      if (revealTimer) clearInterval(revealTimer);
      if (finalTimer) clearTimeout(finalTimer);
    };
  }, []);

  // ── Hero demo: simulated stream numbers (marketing flavor, NOT real data) ──
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const el = (name: string) => root.querySelector<HTMLElement>(`[data-or-ref="${name}"]`);

    const POOL = 12;
    const rate = FLOW_RATE;
    const STREAM_SECS = Math.min(22, (POOL * 0.66) / rate);
    const CAP = rate * STREAM_SECS;
    const SETTLE_SECS = 1.8;
    const REFUND_SECS = 2.4;
    const CYCLE = STREAM_SECS + SETTLE_SECS + REFUND_SECS;
    let rcptCounter = 91;
    let block = 8214003;
    let lastRcpt = 0;
    const fmt = (x: number) => Math.max(0, x).toFixed(6);
    const start = performance.now();
    let raf = 0;

    const setTxt = (name: string, v: string) => {
      const n = el(name);
      if (n && n.textContent !== v) n.textContent = v;
    };
    const setBar = (pct: string) => {
      const n = el("bar");
      if (n) n.style.width = pct + "%";
    };
    setTxt("rate", String(rate));

    const tick = (now: number) => {
      const tAll = (now - start) / 1000;
      const t = tAll % CYCLE;
      if (t < STREAM_SECS) {
        const streamed = Math.min(CAP, rate * t);
        setTxt("phase", "streaming");
        setTxt("streamed", fmt(streamed));
        setTxt("residual", fmt(POOL - streamed));
        setBar(((streamed / POOL) * 100).toFixed(2));
        if (tAll - lastRcpt > 2.4) {
          lastRcpt = tAll;
          rcptCounter += 1;
          block += 1 + Math.floor(Math.random() * 3);
          setTxt("rcptId", "#0" + rcptCounter);
          setTxt("rcptKind", "settle");
          setTxt("rcptAmt", (rate * 2.4).toFixed(6) + " USDC");
          setTxt("rcptBlock", block.toLocaleString("en-US") + " ✓");
        }
      } else if (t < STREAM_SECS + SETTLE_SECS) {
        setTxt("phase", "settled");
        setTxt("streamed", fmt(CAP));
        setTxt("residual", fmt(POOL - CAP));
        setBar(((CAP / POOL) * 100).toFixed(2));
      } else {
        const k = (t - STREAM_SECS - SETTLE_SECS) / REFUND_SECS;
        const residualLeft = (POOL - CAP) * (1 - Math.min(1, k));
        setTxt("phase", "residual → payer");
        setTxt("streamed", fmt(CAP));
        setTxt("residual", fmt(residualLeft));
        const rk = el("rcptKind");
        if (k > 0.5 && rk && rk.textContent !== "residual return") {
          rcptCounter += 1;
          block += 2;
          setTxt("rcptId", "#0" + rcptCounter);
          setTxt("rcptKind", "residual return");
          setTxt("rcptAmt", fmt(POOL - CAP) + " USDC");
          setTxt("rcptBlock", block.toLocaleString("en-US") + " ✓");
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={rootRef}
      style={{
        fontFamily: "Inter, system-ui, sans-serif",
        color: "#0B1120",
        background: "#EDF0F4",
        overflowX: "clip",
        minHeight: "100vh",
        scrollBehavior: "smooth",
      }}
    >
      {/* ══════════ TESTNET BANNER ══════════ */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          background: "#04070D",
          color: "rgba(255,255,255,0.72)",
          fontFamily: MONO,
          fontSize: 11,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
          padding: "8px 16px",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "#00C878",
            boxShadow: "0 0 10px rgba(0,200,120,0.9)",
            animation: "or-pulse 2.4s ease-in-out infinite",
          }}
        />
        <span>Live on Arc testnet · chain 5042002</span>
      </div>

      {/* ══════════ NAV ══════════ */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          background: "rgba(237,240,244,0.78)",
          borderBottom: "1px solid rgba(11,17,32,0.07)",
        }}
      >
        <div
          style={{
            maxWidth: 1200,
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 32px",
          }}
        >
          <a href="#top" style={{ display: "flex", alignItems: "center", gap: 11, textDecoration: "none", color: "#0B1120" }}>
            <LogoMark size={34} radius={10} />
            <span style={{ fontFamily: MONO, fontSize: 13, fontWeight: 600, letterSpacing: "0.2em" }}>OPENRAILS</span>
          </a>
          {/* Desktop nav links — collapsed behind the hamburger below 768px. */}
          {!isMobile && (
            <nav style={{ display: "flex", alignItems: "center", gap: 30, fontSize: 13.5, fontWeight: 500, color: "rgba(11,17,32,0.66)" }}>
              {/* "Product" nav item hidden — that page isn't being built this pass (see report). */}
              <Link to="/docs" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>Docs</Link>
              <a href="#developers" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>Developers</a>
              <Link to="/cockpit" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>Cockpit</Link>
            </nav>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {!isMobile && (
              <a
                href="https://github.com/Jaydearcadian/mcosm-openrails"
                target="_blank"
                rel="noreferrer"
                className="or-github"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 7,
                  fontFamily: MONO,
                  fontSize: 12,
                  color: "rgba(11,17,32,0.62)",
                  textDecoration: "none",
                  padding: "9px 14px",
                  borderRadius: 999,
                  border: "1px solid rgba(11,17,32,0.12)",
                  background: "rgba(255,255,255,0.5)",
                }}
              >
                GitHub ↗
              </a>
            )}
            {/* Primary CTA stays visible at every width. */}
            <Link
              to="/cockpit"
              className="or-nav-cta"
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: "#FFFFFF",
                textDecoration: "none",
                padding: "10px 18px",
                borderRadius: 999,
                background: "#04070D",
                boxShadow: "0 6px 18px rgba(4,7,13,0.25)",
              }}
            >
              Try it on testnet →
            </Link>
            {isMobile && (
              <button
                type="button"
                aria-label="Menu"
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((o) => !o)}
                style={{
                  display: "grid",
                  placeItems: "center",
                  width: 40,
                  height: 40,
                  padding: 0,
                  cursor: "pointer",
                  borderRadius: 12,
                  border: "1px solid rgba(11,17,32,0.12)",
                  background: "rgba(255,255,255,0.6)",
                  color: "#04070D",
                }}
              >
                <span style={{ display: "grid", gap: 4, width: 16 }}>
                  <span style={{ height: 1.6, background: "currentColor", borderRadius: 2, transition: "transform 0.2s", transform: menuOpen ? "translateY(5.6px) rotate(45deg)" : "none" }} />
                  <span style={{ height: 1.6, background: "currentColor", borderRadius: 2, opacity: menuOpen ? 0 : 1, transition: "opacity 0.2s" }} />
                  <span style={{ height: 1.6, background: "currentColor", borderRadius: 2, transition: "transform 0.2s", transform: menuOpen ? "translateY(-5.6px) rotate(-45deg)" : "none" }} />
                </span>
              </button>
            )}
          </div>
        </div>
        {/* Mobile dropdown panel — frosted white, dark accents, matches app language. */}
        {isMobile && menuOpen && (
          <nav
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "8px 20px 18px",
              borderTop: "1px solid rgba(11,17,32,0.07)",
              fontSize: 15,
              fontWeight: 500,
              color: "rgba(11,17,32,0.8)",
            }}
          >
            <Link to="/docs" onClick={() => setMenuOpen(false)} style={{ color: "inherit", textDecoration: "none", padding: "11px 4px" }}>Docs</Link>
            <a href="#developers" onClick={() => setMenuOpen(false)} style={{ color: "inherit", textDecoration: "none", padding: "11px 4px" }}>Developers</a>
            <Link to="/cockpit" onClick={() => setMenuOpen(false)} style={{ color: "inherit", textDecoration: "none", padding: "11px 4px" }}>Cockpit</Link>
            <a
              href="https://github.com/Jaydearcadian/mcosm-openrails"
              target="_blank"
              rel="noreferrer"
              onClick={() => setMenuOpen(false)}
              style={{ fontFamily: MONO, fontSize: 13, color: "rgba(11,17,32,0.7)", textDecoration: "none", padding: "11px 4px" }}
            >
              GitHub ↗
            </a>
          </nav>
        )}
      </header>

      {/* ══════════ HERO ══════════ */}
      <section
        id="top"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "radial-gradient(120% 90% at 50% -20%, #FDFEFF 0%, #EDF0F4 55%, #E2E7ED 100%)",
        }}
      >
        <ImageSlot src="bg-horizon.png" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(237,240,244,0.62) 0%, rgba(237,240,244,0.28) 42%, rgba(237,240,244,0.72) 100%)",
            pointerEvents: "none",
          }}
        />

        {/* chrome rails backdrop */}
        <svg
          viewBox="0 0 1440 760"
          preserveAspectRatio="xMidYMax slice"
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
        >
          <defs>
            <linearGradient id="railSteel" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#9AA6B5" stopOpacity="0" />
              <stop offset="0.35" stopColor="#B9C3CF" stopOpacity="0.9" />
              <stop offset="0.6" stopColor="#FFFFFF" />
              <stop offset="0.8" stopColor="#AEB9C6" stopOpacity="0.8" />
              <stop offset="1" stopColor="#9AA6B5" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="railEmerald" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#009E60" stopOpacity="0" />
              <stop offset="0.5" stopColor="#00C878" />
              <stop offset="1" stopColor="#009E60" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g fill="none">
            <path d="M-60,760 C240,700 420,610 720,600 C1060,590 1260,650 1500,610" stroke="url(#railSteel)" strokeWidth="2.4" opacity="0.85" />
            <path d="M-60,730 C260,672 440,580 730,572 C1070,562 1270,622 1500,580" stroke="url(#railSteel)" strokeWidth="1.6" opacity="0.7" />
            <path d="M-60,700 C280,646 460,552 740,546 C1080,536 1280,596 1500,552" stroke="url(#railSteel)" strokeWidth="1.2" opacity="0.55" />
            <path d="M-60,672 C300,622 480,526 750,522 C1090,512 1290,572 1500,526" stroke="url(#railSteel)" strokeWidth="1" opacity="0.4" />
            <path d="M-60,648 C320,600 500,504 760,500 C1100,490 1300,550 1500,504" stroke="url(#railSteel)" strokeWidth="0.8" opacity="0.3" />
            <path
              d="M-60,745 C250,686 430,595 725,586 C1065,576 1265,636 1500,595"
              stroke="url(#railEmerald)"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeDasharray="70 340"
              style={{ animation: "or-dash 7s linear infinite" }}
            />
            <path
              d="M-60,686 C290,634 470,539 745,534 C1085,524 1285,584 1500,539"
              stroke="#FFFFFF"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeDasharray="34 480"
              style={{ animation: "or-dash 11s linear infinite", animationDelay: "-4s" }}
            />
          </g>
        </svg>
        <div
          style={{
            position: "absolute",
            left: -180,
            top: -160,
            width: 560,
            height: 560,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(0,158,96,0.10), transparent 65%)",
            filter: "blur(50px)",
            animation: "or-drift 18s ease-in-out infinite",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: -200,
            top: 140,
            width: 620,
            height: 620,
            borderRadius: "50%",
            background: "radial-gradient(circle, rgba(154,166,181,0.28), transparent 65%)",
            filter: "blur(60px)",
            animation: "or-drift 22s ease-in-out infinite",
            animationDelay: "-8s",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            position: "relative",
            pointerEvents: "none",
            maxWidth: 1200,
            margin: "0 auto",
            padding: "88px 32px 40px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 9,
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "rgba(11,17,32,0.55)",
              border: "1px solid rgba(11,17,32,0.12)",
              background: "rgba(255,255,255,0.6)",
              borderRadius: 999,
              padding: "7px 16px",
              pointerEvents: "auto",
            }}
          >
            <span style={{ color: "rgb(0, 158, 96)" }}>✦</span>intent-driven clearing and settlement infrastructure for streamed work on Arc
          </div>
          <h1
            style={{
              pointerEvents: "auto",
              margin: "26px 0 0",
              maxWidth: 1020,
              fontSize: "clamp(44px, 5.6vw, 78px)",
              lineHeight: 1.04,
              letterSpacing: "-0.035em",
              fontWeight: 700,
              textWrap: "balance" as CSSProperties["textWrap"],
            }}
          >
            Per-second micropayments for the{" "}
            <em
              style={{
                fontStyle: "normal",
                background: "linear-gradient(120deg, #009E60 0%, #00C878 60%, #0B1120 130%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              machine &amp; creator economy
            </em>{" "}
            and the open internet.
          </h1>
          <p
            style={{
              pointerEvents: "auto",
              margin: "24px 0 0",
              maxWidth: 660,
              fontSize: 18,
              lineHeight: 1.65,
              color: "rgba(11,17,32,0.62)",
              textWrap: "pretty" as CSSProperties["textWrap"],
            }}
          >
            OpenRails is a non-custodial payment rail where value streams as it's used, and whatever you don't use comes back. For people, businesses, creators, and AI agents.
          </p>
          <div style={{ pointerEvents: "auto", display: "flex", gap: 14, marginTop: 34, flexWrap: "wrap", justifyContent: "center" }}>
            <Link
              to="/cockpit"
              className="or-hero-cta"
              style={{
                position: "relative",
                overflow: "hidden",
                fontSize: 15,
                fontWeight: 600,
                color: "#FFFFFF",
                textDecoration: "none",
                padding: "15px 30px",
                borderRadius: 999,
                background: "#04070D",
                boxShadow: "0 10px 28px rgba(4,7,13,0.3)",
              }}
            >
              Try it on testnet →
            </Link>
            <a
              href="#how"
              className="or-outline"
              style={{
                fontSize: 15,
                fontWeight: 600,
                color: "#0B1120",
                textDecoration: "none",
                padding: "15px 30px",
                borderRadius: 999,
                border: "1px solid rgba(11,17,32,0.16)",
                background: "rgba(255,255,255,0.65)",
                backdropFilter: "blur(10px)",
                WebkitBackdropFilter: "blur(10px)",
              }}
            >
              Read how it works
            </a>
          </div>

          {/* ── hero diagram: floating cards around a live Paycard Stream ── */}
          <div
            className="or-hero-grid"
            style={{
              pointerEvents: "auto",
              position: "relative",
              width: "100%",
              marginTop: 72,
              display: "grid",
              gap: 28,
              alignItems: "center",
              textAlign: "left",
            }}
          >
            {/* left column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div data-reveal="0" style={{ ...frostCard, transform: "rotate(-1.4deg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#009E60" }}>RailsFlow</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "rgba(11,17,32,0.4)" }}>ask to be paid</span>
                </div>
                <div
                  style={{
                    marginTop: 10,
                    fontFamily: MONO,
                    fontSize: 11.5,
                    color: "rgba(11,17,32,0.72)",
                    background: "rgba(11,17,32,0.045)",
                    border: "1px solid rgba(11,17,32,0.07)",
                    borderRadius: 8,
                    padding: "8px 10px",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  openrails.link/#or=eyJ2IjoiMi4wIiw…
                </div>
                <div style={{ marginTop: 10, fontSize: 12.5, color: "rgba(11,17,32,0.6)", lineHeight: 1.5 }}>
                  Attach your terms, share the link, get paid as you deliver.
                </div>
              </div>
              <div data-reveal="120" style={{ ...frostCard, transform: "rotate(1.1deg)", marginLeft: 26 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#009E60" }}>RailsCard</span>
                  <span style={{ fontFamily: MONO, fontSize: 10, color: "rgba(11,17,32,0.4)" }}>send to claim</span>
                </div>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 10 }}>
                  <span style={{ fontFamily: MONO, fontSize: 22, fontWeight: 600 }}>25.00</span>
                  <span style={{ fontFamily: MONO, fontSize: 11, color: "rgba(11,17,32,0.45)" }}>USDC · bounded</span>
                </div>
                <div style={{ marginTop: 8, fontSize: 12.5, color: "rgba(11,17,32,0.6)" }}>Pre-authorized value, ready to redeem.</div>
              </div>
            </div>

            {/* center: live Paycard Stream */}
            <div data-reveal="60" style={{ position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  inset: -30,
                  background: "radial-gradient(circle, rgba(0,158,96,0.14), transparent 70%)",
                  filter: "blur(20px)",
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "relative",
                  background: "linear-gradient(165deg, #0B1322 0%, #04070D 70%)",
                  color: "#FFFFFF",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 22,
                  padding: "26px 28px",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.14), 0 30px 70px rgba(4,7,13,0.4)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "40%",
                    height: "100%",
                    background: "linear-gradient(105deg, transparent, rgba(255,255,255,0.05), transparent)",
                    animation: "or-shimmer 5.5s ease-in-out infinite",
                    pointerEvents: "none",
                  }}
                />
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.55)" }}>Paycard Stream</span>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#00C878" }}>
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: "#00C878",
                        boxShadow: "0 0 8px rgba(0,200,120,0.9)",
                        animation: "or-pulse 2s ease-in-out infinite",
                      }}
                    />
                    <span data-or-ref="phase">streaming</span>
                  </span>
                </div>
                <div style={{ marginTop: 20, fontFamily: MONO }}>
                  <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgba(255,255,255,0.42)" }}>settled to recipient</div>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 4 }}>
                    <span data-or-ref="streamed" style={{ fontSize: 40, fontWeight: 600, fontVariantNumeric: "tabular-nums", letterSpacing: "-0.02em" }}>0.000000</span>
                    <span style={{ fontSize: 13, color: "rgba(255,255,255,0.5)" }}>USDC</span>
                  </div>
                </div>
                <div style={{ marginTop: 16, height: 8, borderRadius: 999, background: "rgba(255,255,255,0.09)", overflow: "hidden" }}>
                  <div
                    data-or-ref="bar"
                    style={{
                      height: "100%",
                      width: "0%",
                      borderRadius: 999,
                      background: "repeating-linear-gradient(90deg, #00C878 0, #00C878 10px, #009E60 10px, #009E60 20px)",
                      backgroundSize: "28px 8px",
                      animation: "or-flow 0.7s linear infinite",
                      boxShadow: "0 0 14px rgba(0,200,120,0.6)",
                    }}
                  />
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontFamily: MONO, fontSize: 11.5, color: "rgba(255,255,255,0.55)" }}>
                  <span>escrowed <span style={{ color: "#FFFFFF" }}>12.000000</span></span>
                  <span>rate <span style={{ color: "#FFFFFF" }}><span data-or-ref="rate">0.38</span>/s</span></span>
                  <span>residual <span data-or-ref="residual" style={{ color: "#FFFFFF" }}>12.000000</span></span>
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginTop: 18,
                    paddingTop: 16,
                    borderTop: "1px solid rgba(255,255,255,0.08)",
                    fontFamily: MONO,
                    fontSize: 11,
                    color: "rgba(255,255,255,0.45)",
                  }}
                >
                  <span>payer 0x7fA3…c21E</span>
                  <span style={{ color: "rgba(255,255,255,0.3)" }}>→</span>
                  <span>recipient 0x941C…6D0b</span>
                </div>
              </div>
            </div>

            {/* right column */}
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div data-reveal="180" style={{ ...frostCard, transform: "rotate(1.3deg)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.18em", textTransform: "uppercase", color: "#009E60" }}>Receipt</span>
                  <span data-or-ref="rcptId" style={{ fontFamily: MONO, fontSize: 10, color: "rgba(11,17,32,0.4)" }}>#0091</span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 12, fontFamily: MONO, fontSize: 11.5, color: "rgba(11,17,32,0.72)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>event</span><span data-or-ref="rcptKind" style={{ color: "#0B1120", fontWeight: 600 }}>settle</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>amount</span><span data-or-ref="rcptAmt" style={{ color: "#0B1120", fontWeight: 600 }}>0.912331 USDC</span></div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}><span>block</span><span data-or-ref="rcptBlock">8,214,003 ✓</span></div>
                </div>
              </div>
              <div data-reveal="260" style={{ ...frostCard, padding: "16px 20px", transform: "rotate(-1deg)", marginRight: 22 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, borderRadius: 9, background: "rgba(0,158,96,0.1)", color: "#009E60", fontSize: 14 }}>↩</span>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Residual returned</div>
                    <div style={{ fontFamily: MONO, fontSize: 11, color: "rgba(11,17,32,0.5)" }}>unused funds → payer, automatically</div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* lifecycle pills */}
          <div
            style={{
              pointerEvents: "auto",
              display: "flex",
              alignItems: "center",
              gap: 0,
              margin: "56px 0 26px",
              fontFamily: MONO,
              fontSize: 11,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              color: "rgba(11,17,32,0.5)",
            }}
          >
            <span style={lifecyclePill}>Sign</span>
            <span style={lifecycleDash} />
            <span style={lifecyclePill}>Clear</span>
            <span style={lifecycleDash} />
            <span style={{ padding: "7px 16px", border: "1px solid rgba(0,158,96,0.4)", borderRadius: 999, background: "rgba(0,158,96,0.08)", color: "#009E60" }}>Stream</span>
            <span style={lifecycleDash} />
            <span style={lifecyclePill}>Settle</span>
            <span style={lifecycleDash} />
            <span style={lifecyclePill}>Return</span>
          </div>
        </div>
      </section>

      {/* ══════════ MARQUEE STRIP ══════════ */}
      <div
        style={{
          borderTop: "1px solid rgba(11,17,32,0.07)",
          borderBottom: "1px solid rgba(11,17,32,0.07)",
          background: "rgba(255,255,255,0.55)",
          overflow: "hidden",
          padding: "16px 0",
        }}
      >
        <div style={{ display: "flex", width: "max-content", animation: "or-marquee 34s linear infinite" }}>
          <MarqueeContent />
          <MarqueeContent />
        </div>
      </div>

      {/* ══════════ HOW IT WORKS ══════════ */}
      <section id="how" style={{ position: "relative" }}>
        <ImageSlot src="bg-wave.png" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(237,240,244,0.8) 0%, rgba(237,240,244,0.68) 55%, rgba(237,240,244,0.82) 100%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", pointerEvents: "none", maxWidth: 1200, margin: "0 auto", padding: "110px 32px 90px" }}>
          <div data-reveal="0" style={{ textAlign: "center", pointerEvents: "auto" }}>
            <div style={eyebrowPill}>How it works</div>
            <h2 style={{ ...sectionH2, margin: "22px auto 0", maxWidth: 720 }}>
              The internet moves data continuously. <span style={{ color: "rgba(11,17,32,0.45)" }}>Money still moves in lumps.</span>
            </h2>
            <p style={{ margin: "18px auto 0", maxWidth: 600, fontSize: 16, lineHeight: 1.65, color: "rgba(11,17,32,0.6)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
              OpenRails fixes the mismatch: money that moves like data: continuously, metered, and only for what's actually used.
            </p>
          </div>

          <div className="or-grid-3" style={{ pointerEvents: "auto", display: "grid", gap: 24, marginTop: 64 }}>
            <div
              data-reveal="0"
              style={{
                position: "relative",
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(20px) saturate(160%)",
                WebkitBackdropFilter: "blur(20px) saturate(160%)",
                border: "1px solid rgba(11,17,32,0.08)",
                borderRadius: 20,
                padding: "30px 28px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 14px 34px rgba(11,17,32,0.07)",
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.18em", color: "#009E60" }}>01</div>
              <h3 style={{ margin: "16px 0 0", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>Sign</h3>
              <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                Authorize exactly what you want: an amount, a rate, a limit. Nothing can exceed it.
              </p>
              <div
                style={{
                  marginTop: 20,
                  fontFamily: MONO,
                  fontSize: 11,
                  color: "rgba(11,17,32,0.55)",
                  background: "rgba(11,17,32,0.045)",
                  border: "1px solid rgba(11,17,32,0.07)",
                  borderRadius: 10,
                  padding: "12px 14px",
                  lineHeight: 1.7,
                }}
              >
                intent&nbsp;{"{"} pool: <span style={{ color: "#009E60" }}>12.00</span>,<br />&nbsp;&nbsp;rate: <span style={{ color: "#009E60" }}>0.38/s</span>, ttl: <span style={{ color: "#009E60" }}>3600</span> {"}"}<br /><span style={{ color: "rgba(11,17,32,0.4)" }}>sig: EIP-712 · bounded</span>
              </div>
            </div>
            <div
              data-reveal="120"
              style={{
                position: "relative",
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(20px) saturate(160%)",
                WebkitBackdropFilter: "blur(20px) saturate(160%)",
                border: "1px solid rgba(11,17,32,0.08)",
                borderRadius: 20,
                padding: "30px 28px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 14px 34px rgba(11,17,32,0.07)",
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.18em", color: "#009E60" }}>02</div>
              <h3 style={{ margin: "16px 0 0", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>Stream</h3>
              <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                Money clears into an on-chain vault and flows to the recipient as they deliver, in real time.
              </p>
              <div style={{ marginTop: 20, height: 8, borderRadius: 999, background: "rgba(11,17,32,0.07)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: "62%",
                    borderRadius: 999,
                    background: "repeating-linear-gradient(90deg, #00C878 0, #00C878 10px, #009E60 10px, #009E60 20px)",
                    backgroundSize: "28px 8px",
                    animation: "or-flow 0.7s linear infinite",
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12, fontFamily: MONO, fontSize: 11, color: "rgba(11,17,32,0.5)" }}>
                <span>per second · per call · per task · per play</span>
              </div>
            </div>
            <div
              data-reveal="240"
              style={{
                position: "relative",
                background: "rgba(255,255,255,0.72)",
                backdropFilter: "blur(20px) saturate(160%)",
                WebkitBackdropFilter: "blur(20px) saturate(160%)",
                border: "1px solid rgba(11,17,32,0.08)",
                borderRadius: 20,
                padding: "30px 28px",
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 14px 34px rgba(11,17,32,0.07)",
              }}
            >
              <div style={{ fontFamily: MONO, fontSize: 12, letterSpacing: "0.18em", color: "#009E60" }}>03</div>
              <h3 style={{ margin: "16px 0 0", fontSize: 21, fontWeight: 700, letterSpacing: "-0.02em" }}>Settle &amp; refund</h3>
              <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                Stop anytime. They keep what they earned; the rest returns to you, automatically.
              </p>
              <div style={{ display: "flex", gap: 10, marginTop: 20, fontFamily: MONO, fontSize: 11 }}>
                <div style={{ flex: 1, background: "rgba(0,158,96,0.08)", border: "1px solid rgba(0,158,96,0.25)", borderRadius: 10, padding: "10px 12px", color: "#00794A" }}>
                  earned<br /><span style={{ fontSize: 14, fontWeight: 600 }}>7.42</span>
                </div>
                <div style={{ flex: 1, background: "rgba(11,17,32,0.045)", border: "1px solid rgba(11,17,32,0.07)", borderRadius: 10, padding: "10px 12px", color: "rgba(11,17,32,0.6)" }}>
                  returned ↩<br /><span style={{ fontSize: 14, fontWeight: 600, color: "#0B1120" }}>4.58</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ THE DIFFERENCE ══════════ */}
      <section style={{ position: "relative", background: "linear-gradient(180deg, #E4E8EE 0%, #EDF0F4 100%)", borderTop: "1px solid rgba(11,17,32,0.06)" }}>
        <ImageSlot src="bg-streaks.png" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(232,235,241,0.82) 0%, rgba(237,240,244,0.7) 55%, rgba(237,240,244,0.82) 100%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", pointerEvents: "none", maxWidth: 1200, margin: "0 auto", padding: "100px 32px" }}>
          <div data-reveal="0" className="or-grid-2" style={{ pointerEvents: "auto", display: "grid", gap: 60, alignItems: "end" }}>
            <div>
              <div style={eyebrowPill}>The difference</div>
              <h2 style={{ ...sectionH2, margin: "22px 0 0" }}>
                No overpaying. No waiting. <span style={{ color: "rgba(11,17,32,0.45)" }}>No one holding your money.</span>
              </h2>
            </div>
            <p style={{ fontSize: 16, lineHeight: 1.7, color: "rgba(11,17,32,0.6)", margin: 0, textWrap: "pretty" as CSSProperties["textWrap"] }}>
              funds are committed into a bounded escrow, reconciled down to actual usage, and no middleman ever holds them. The only thing holding your money is code you can read.
            </p>
          </div>

          <div className="or-grid-3" style={{ pointerEvents: "auto", display: "grid", gap: 24, marginTop: 60 }}>
            {[
              { d: "0", sym: "Σ", title: "Only pay for what you use.", body: 'Funds are reconciled down to actual usage; the unused remainder comes back automatically. No overpaying, no "estimate and refund later."' },
              { d: "120", sym: "≈", title: "Paid as you deliver.", body: "Value streams in real time from money already escrowed: guaranteed, chargeback-free, no waiting on an invoice." },
              { d: "240", sym: "⊘", title: "Yours the whole way.", body: "You sign what you authorize; nothing can move more. Non-custodial, bounded by design: a bug, a bad actor, or a runaway agent can never drain you." },
            ].map((c) => (
              <div
                key={c.sym}
                data-reveal={c.d}
                style={{
                  background: "rgba(255,255,255,0.78)",
                  border: "1px solid rgba(11,17,32,0.08)",
                  borderRadius: 20,
                  padding: "32px 28px",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), 0 14px 34px rgba(11,17,32,0.07)",
                }}
              >
                <span style={{ display: "grid", placeItems: "center", width: 42, height: 42, borderRadius: 12, background: "rgba(0,158,96,0.1)", color: "#009E60", fontSize: 18, fontFamily: MONO, fontWeight: 700 }}>{c.sym}</span>
                <h3 style={{ margin: "20px 0 0", fontSize: 19, fontWeight: 700, letterSpacing: "-0.02em" }}>{c.title}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 14.5, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ BUILT FOR EVERYONE ══════════ */}
      <section style={{ position: "relative" }}>
        <ImageSlot src="bg-sphere.png" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(237,240,244,0.82) 0%, rgba(237,240,244,0.7) 55%, rgba(237,240,244,0.82) 100%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", pointerEvents: "none", maxWidth: 1200, margin: "0 auto", padding: "110px 32px" }}>
          <div data-reveal="0" style={{ textAlign: "center", pointerEvents: "auto" }}>
            <div style={eyebrowPill}>Built for everyone</div>
            <h2 style={{ ...sectionH2, margin: "22px auto 0", maxWidth: 760 }}>One rail for everyone who sends or receives value on the internet.</h2>
          </div>
          <div className="or-grid-4" style={{ pointerEvents: "auto", display: "grid", gap: 20, marginTop: 60 }}>
            {AUDIENCES.map((a) => (
              <div
                key={a.tag}
                data-reveal={a.delay}
                style={{
                  background: "rgba(255,255,255,0.72)",
                  backdropFilter: "blur(20px) saturate(160%)",
                  WebkitBackdropFilter: "blur(20px) saturate(160%)",
                  border: "1px solid rgba(11,17,32,0.08)",
                  borderRadius: 20,
                  padding: "28px 24px",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.9), 0 14px 34px rgba(11,17,32,0.07)",
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                }}
              >
                <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "#009E60" }}>{a.tag}</div>
                <h3 style={{ margin: "14px 0 0", fontSize: 18, fontWeight: 700, letterSpacing: "-0.02em" }}>{a.title}</h3>
                <p style={{ margin: "10px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>{a.body}</p>
                <div style={{ marginTop: "auto", paddingTop: 18, fontFamily: MONO, fontSize: 11, color: "rgba(11,17,32,0.45)" }}>{a.meta}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════ THE TWO LINKS ══════════ */}
      <section style={{ position: "relative", background: "linear-gradient(180deg, #E4E8EE 0%, #EDF0F4 100%)", borderTop: "1px solid rgba(11,17,32,0.06)" }}>
        <ImageSlot src="bg-swirl.png" />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(232,235,241,0.82) 0%, rgba(237,240,244,0.7) 55%, rgba(237,240,244,0.82) 100%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", pointerEvents: "none", maxWidth: 1200, margin: "0 auto", padding: "100px 32px" }}>
          <div data-reveal="0" style={{ textAlign: "center", pointerEvents: "auto" }}>
            <div style={eyebrowPill}>The two links</div>
            <h2 style={{ ...sectionH2, margin: "22px auto 0", maxWidth: 700 }}>A link is the whole interface.</h2>
            <p style={{ margin: "18px auto 0", maxWidth: 560, fontSize: 16, lineHeight: 1.65, color: "rgba(11,17,32,0.6)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
              Ask to be paid, or send value to claim. Payloads travel as URL fragments; they never touch a server.
            </p>
          </div>

          <div className="or-grid-2" style={{ pointerEvents: "auto", display: "grid", gap: 24, marginTop: 60 }}>
            <div data-reveal="0" style={{ background: "rgba(255,255,255,0.78)", border: "1px solid rgba(11,17,32,0.08)", borderRadius: 22, padding: "36px 34px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), 0 18px 44px rgba(11,17,32,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>RailsFlow</h3>
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#009E60", border: "1px solid rgba(0,158,96,0.3)", background: "rgba(0,158,96,0.07)", borderRadius: 999, padding: "5px 12px" }}>ask to be paid</span>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                A link to ask to be paid. Attach your terms, share it, and get paid as you deliver.
              </p>
              <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 12, color: "rgba(11,17,32,0.72)", background: "rgba(11,17,32,0.045)", border: "1px solid rgba(11,17,32,0.07)", borderRadius: 12, padding: "14px 16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                https://openrails.link/pay<span style={{ color: "#009E60" }}>#or=</span>eyJ2IjoiMi4wIiwia2luZCI6ImZsb3ci…
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(11,17,32,0.5)" }}>
                <span style={{ border: "1px solid rgba(11,17,32,0.12)", borderRadius: 999, padding: "5px 12px", background: "rgba(255,255,255,0.6)" }}>invoice</span>
                <span style={{ border: "1px solid rgba(11,17,32,0.12)", borderRadius: 999, padding: "5px 12px", background: "rgba(255,255,255,0.6)" }}>paywall</span>
                <span style={{ border: "1px solid rgba(11,17,32,0.12)", borderRadius: 999, padding: "5px 12px", background: "rgba(255,255,255,0.6)" }}>price tag</span>
              </div>
            </div>
            <div data-reveal="140" style={{ background: "rgba(255,255,255,0.78)", border: "1px solid rgba(11,17,32,0.08)", borderRadius: 22, padding: "36px 34px", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.95), 0 18px 44px rgba(11,17,32,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <h3 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" }}>RailsCard</h3>
                <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "#009E60", border: "1px solid rgba(0,158,96,0.3)", background: "rgba(0,158,96,0.07)", borderRadius: 999, padding: "5px 12px" }}>send to claim</span>
              </div>
              <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.65, color: "rgba(11,17,32,0.62)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                A link to send value someone can claim. Pre-authorized, bounded, ready to redeem, bearer or recipient-bound.
              </p>
              <div style={{ marginTop: 22, fontFamily: MONO, fontSize: 12, color: "rgba(11,17,32,0.72)", background: "rgba(11,17,32,0.045)", border: "1px solid rgba(11,17,32,0.07)", borderRadius: 12, padding: "14px 16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                https://openrails.link/claim<span style={{ color: "#009E60" }}>#or=</span>eyJ2IjoiMi4wIiwia2luZCI6ImNhcmQi…
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18, fontFamily: MONO, fontSize: 10.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(11,17,32,0.5)" }}>
                <span style={{ border: "1px solid rgba(11,17,32,0.12)", borderRadius: 999, padding: "5px 12px", background: "rgba(255,255,255,0.6)" }}>gift card</span>
                <span style={{ border: "1px solid rgba(11,17,32,0.12)", borderRadius: 999, padding: "5px 12px", background: "rgba(255,255,255,0.6)" }}>payout</span>
                <span style={{ border: "1px solid rgba(11,17,32,0.12)", borderRadius: 999, padding: "5px 12px", background: "rgba(255,255,255,0.6)" }}>agent budget</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ TRUST + DEVELOPERS (dark band) ══════════ */}
      <section id="developers" style={{ position: "relative", background: "#04070D", color: "#FFFFFF", overflow: "hidden" }}>
        <ImageSlot src="bg-streaks.png" opacity={0.5} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, rgba(4,7,13,0.9) 0%, rgba(4,7,13,0.82) 50%, rgba(4,7,13,0.92) 100%)",
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.04,
            background: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
            backgroundSize: "64px 64px",
            pointerEvents: "none",
          }}
        />

        <div style={{ position: "relative", pointerEvents: "none", maxWidth: 1200, margin: "0 auto", padding: "110px 32px" }}>
          <div className="or-grid-dev" style={{ pointerEvents: "auto", display: "grid", gap: 70, alignItems: "start" }}>
            {/* trust */}
            <div data-reveal="0">
              <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "7px 16px", background: "rgba(255,255,255,0.04)" }}>Trust</div>
              <h2 style={{ ...sectionH2, margin: "22px 0 0" }}>
                Built to be trusted, <span style={{ color: "rgba(255,255,255,0.45)" }}>not trust-me.</span>
              </h2>
              <p style={{ margin: "18px 0 0", fontSize: 16, lineHeight: 1.7, color: "rgba(255,255,255,0.6)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                Escrow lives in a bounded on-chain vault, not our wallet. Every open, settlement, and refund is verifiable on-chain.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 0, marginTop: 34, fontFamily: MONO, fontSize: 12.5 }}>
                {[
                  ["network", "Arc testnet · chain 5042002"],
                  ["canonical hub (V2)", "0x941C…6D0b"],
                  ["tests passing", "84 Hardhat · 9 Foundry"],
                  ["accounts", "EOAs + smart accounts (EIP-1271)"],
                  ["gas", "sponsored: keeper relays, gasless"],
                ].map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "13px 0", borderBottom: "1px solid rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.55)" }}>
                    <span>{k}</span>
                    <span style={{ color: "#FFFFFF" }}>{v}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* developers */}
            <div data-reveal="140">
              <div style={{ display: "inline-block", fontFamily: MONO, fontSize: 11, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(255,255,255,0.5)", border: "1px solid rgba(255,255,255,0.14)", borderRadius: 999, padding: "7px 16px", background: "rgba(255,255,255,0.04)" }}>For developers &amp; agents</div>
              <h3 style={{ margin: "22px 0 0", fontSize: 26, fontWeight: 700, letterSpacing: "-0.02em", textWrap: "balance" as CSSProperties["textWrap"] }}>One rail. One command.</h3>
              <p style={{ margin: "14px 0 0", fontSize: 15, lineHeight: 1.65, color: "rgba(255,255,255,0.6)", textWrap: "pretty" as CSSProperties["textWrap"] }}>
                Install the SDK and CLI, or plug the MCP server into your agent. Network defaults are built in, so you're a single command from a first payment.
              </p>
              <div style={{ marginTop: 24, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, overflow: "hidden", boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08), 0 20px 50px rgba(0,0,0,0.4)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid rgba(255,255,255,0.08)" }}>
                  <div style={{ display: "flex", gap: 7 }}>
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.18)" }} />
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.18)" }} />
                    <span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.18)" }} />
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: 10, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(255,255,255,0.38)" }}>terminal</span>
                </div>
                <div style={{ padding: "20px 22px", fontFamily: MONO, fontSize: 12.5, lineHeight: 1.85, color: "rgba(255,255,255,0.75)", overflowX: "auto" }}>
                  <div><span style={{ color: "#00C878" }}>$</span> npm i -g openrails-sdk</div>
                  <div><span style={{ color: "#00C878" }}>$</span> openrails pay-stream --recipient 0x… \</div>
                  <div style={{ paddingLeft: 22 }}>--total-allocation-pool 10000 \</div>
                  <div style={{ paddingLeft: 22 }}>--flow-velocity-per-second 1 \</div>
                  <div style={{ paddingLeft: 22 }}>--lifespan-seconds 3600 <span style={{ color: "#00C878" }}>--execute</span></div>
                  <div style={{ color: "rgba(255,255,255,0.35)" }}>✓ stream open · settling per block · receipt emitted</div>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 24 }}>
                <Link to="/docs" className="or-docs-cta" style={{ fontFamily: MONO, fontSize: 12, color: "#04070D", background: "#FFFFFF", textDecoration: "none", padding: "11px 20px", borderRadius: 999, fontWeight: 600 }}>Read the docs</Link>
                <a href="https://www.npmjs.com/package/openrails-sdk" target="_blank" rel="noreferrer" className="or-dark-pill" style={{ fontFamily: MONO, fontSize: 12, color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.04)", textDecoration: "none", padding: "11px 20px", borderRadius: 999 }}>npm: openrails-sdk ↗</a>
                <a href="https://www.npmjs.com/package/openrails-mcp" target="_blank" rel="noreferrer" className="or-dark-pill" style={{ fontFamily: MONO, fontSize: 12, color: "rgba(255,255,255,0.75)", border: "1px solid rgba(255,255,255,0.16)", background: "rgba(255,255,255,0.04)", textDecoration: "none", padding: "11px 20px", borderRadius: 999 }}>agent MCP: openrails-mcp ↗</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════ FINAL CTA ══════════ */}
      <section style={{ position: "relative", overflow: "hidden", background: "#EDF0F4" }}>
        <ImageSlot src="chrome-flow.png" opacity={0.9} />
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: "linear-gradient(180deg, #EDF0F4 0%, rgba(237,240,244,0.55) 34%, rgba(237,240,244,0.18) 70%, rgba(237,240,244,0.75) 100%)",
            pointerEvents: "none",
          }}
        />
        <div style={{ position: "relative", pointerEvents: "none", maxWidth: 1200, margin: "0 auto", padding: "150px 32px 170px", textAlign: "center" }}>
          <h2
            data-reveal="0"
            style={{
              pointerEvents: "auto",
              margin: "0 auto",
              maxWidth: 820,
              fontSize: "clamp(34px, 4.2vw, 58px)",
              lineHeight: 1.08,
              letterSpacing: "-0.035em",
              fontWeight: 700,
              textWrap: "balance" as CSSProperties["textWrap"],
            }}
          >
            Money should move like everything else on the internet: <span style={{ color: "rgba(11,17,32,0.5)" }}>continuously, and only for what you use.</span>
          </h2>
          <div data-reveal="140" style={{ pointerEvents: "auto", marginTop: 38 }}>
            <Link
              to="/cockpit"
              className="or-final-cta"
              style={{
                display: "inline-block",
                fontSize: 16,
                fontWeight: 600,
                color: "#FFFFFF",
                textDecoration: "none",
                padding: "17px 36px",
                borderRadius: 999,
                background: "#04070D",
                boxShadow: "0 14px 38px rgba(4,7,13,0.35)",
              }}
            >
              Try OpenRails on Arc testnet →
            </Link>
          </div>
        </div>
      </section>

      {/* ══════════ FOOTER ══════════ */}
      <footer style={{ borderTop: "1px solid rgba(11,17,32,0.08)", background: "#E7EBF0" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "44px 32px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 24, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <LogoMark size={30} radius={9} />
            <span style={{ fontFamily: MONO, fontSize: 11.5, color: "rgba(11,17,32,0.55)", letterSpacing: "0.04em" }}>
              OpenRails · a non-custodial USDC settlement rail on Arc · testnet, unaudited, test funds only.
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 24, fontSize: 13, color: "rgba(11,17,32,0.6)" }}>
            <Link to="/docs" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>Docs</Link>
            <Link to="/cockpit" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>Cockpit</Link>
            <a href="https://github.com/Jaydearcadian/mcosm-openrails" target="_blank" rel="noreferrer" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>GitHub</a>
            <a href="https://www.npmjs.com/package/openrails-sdk" target="_blank" rel="noreferrer" className="or-navlink" style={{ color: "inherit", textDecoration: "none" }}>npm</a>
          </div>
        </div>
      </footer>
    </div>
  );
}
