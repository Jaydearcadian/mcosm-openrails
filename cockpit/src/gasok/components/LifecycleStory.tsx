import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll } from 'framer-motion';
import { useRef, useState } from 'react';

const chapters = [
  { id: 'workspace', index: '01', label: 'WORKSPACE / OWN', title: 'Ownership becomes explicit.', copy: 'A Workspace anchors the principal, members, applications, and agents before any authority is delegated.', facts: ['PRINCIPAL / WORKSPACE CONTROLLER', 'ACTORS / 04 REGISTERED', 'STATUS / ACTIVE'], event: 'Workspace 01 activated' },
  { id: 'path', index: '02', label: 'PATH / AUTHORISE', title: 'Authority becomes bounded.', copy: 'A Path defines the exact action, asset, counterparty, exposure, velocity, concurrency, and duration available to an actor.', facts: ['ACTION / SETTLE', 'EXPOSURE / ≤ 1,000 USDC', 'MODE / WALLET CONFIRMATION'], event: 'Path 04 assigned to Execution Agent 03' },
  { id: 'baphomet', index: '03', label: 'BAPHOMET / EVALUATE', title: 'Permission becomes deterministic.', copy: 'The Baphomet Policy Engine evaluates a proposal against the Workspace, assigned Path, and current economic state.', facts: ['DECISION / ALLOW', 'RULES / 14 CHECKS', 'DECISION HASH / 0x91…7A'], event: 'Proposal 018 evaluated / ALLOW' },
  { id: 'pact', index: '04', label: 'PACT / COMMIT', title: 'Permission becomes commitment.', copy: 'Parties, terms, proof requirements, settlement rules, and exception policy align and seal into one inspectable commercial object.', facts: ['PACT / 2048', 'VALUE / 420 USDC', 'TERMS HASH / 0xA4…2F'], event: 'Pact 2048 sealed after wallet confirmation' },
  { id: 'proof', index: '05', label: 'PROOF / VERIFY', title: 'Commitment becomes evidence.', copy: 'Evidence attaches to configured checkpoints, is evaluated by the selected verifier, and advances settlement eligibility.', facts: ['CHECKPOINTS / 02 OF 03', 'ELIGIBLE / 210 USDC', 'RESULT / VERIFIED'], event: 'Checkpoint 02 verified / 210 USDC eligible' },
  { id: 'settlement', index: '06', label: 'RAIL / SETTLE', title: 'Verified performance becomes final value.', copy: 'Payment authorization, Paycard, and the Vault route earned and residual value before a canonical Arc receipt closes the financial state.', facts: ['EARNED / 210 USDC', 'RESIDUAL / 210 USDC', 'ARC / CONFIRMED'], event: 'Arc receipt confirmed / value routed' },
  { id: 'gaia', index: '07', label: 'GAIA / RESOLVE', title: 'Exceptions become accountable resolution.', copy: 'Gaia preserves the lifecycle record, applies an authorised determination, and routes bounded rectification without erasing history.', facts: ['CASE / 018', 'OUTCOME / RECTIFIED', 'PACT / CLOSED'], event: 'Gaia case 018 rectified / Pact closed' },
] as const;

const signalPoints = [
  { left: '23%', top: '49%' }, { left: '39%', top: '49%' }, { left: '54%', top: '49%' },
  { left: '68%', top: '38%' }, { left: '80%', top: '38%' }, { left: '73%', top: '68%' }, { left: '47%', top: '77%' },
];

function Route({ d, visible, accent = false, delay = 0 }: { d: string; visible: boolean; accent?: boolean; delay?: number }) {
  const reduceMotion = useReducedMotion();
  return <motion.path className={accent ? 'cinema-route accent' : 'cinema-route'} d={d} pathLength="1" initial={false} animate={{ pathLength: visible ? 1 : 0, opacity: visible ? 1 : 0 }} transition={{ duration: reduceMotion ? 0 : .72, delay, ease: 'easeOut' }} />;
}

function LifecycleMachine({ active }: { active: number }) {
  const reduceMotion = useReducedMotion();
  const point = signalPoints[active];
  return (
    <div className={`cinema-machine chapter-${active + 1}`}>
      <div className="cinema-grid" />
      <div className="cinema-actors" aria-hidden="true">
        {['OWNER', 'APPLICATION', 'AGENT', 'COUNTERPARTY'].map((actor, i) => <motion.span key={actor} className={`cinema-actor cinema-actor-${i + 1}`} animate={{ opacity: active === 0 ? 1 : .25, scale: active === 0 ? 1 : .92 }}><i />{actor}</motion.span>)}
      </div>
      <svg className="cinema-routes" viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true">
        <Route d="M72 110 C150 140 165 250 230 312" visible={active === 0} />
        <Route d="M150 548 C170 460 190 380 230 330" visible={active === 0} />
        <Route d="M930 110 C800 150 750 235 290 315" visible={active === 0} />
        <Route d="M920 550 C790 490 710 410 290 330" visible={active === 0} />
        <Route d="M285 320 L430 320" visible={active >= 1} accent={active === 1} />
        <Route d="M430 320 L570 320" visible={active >= 2} accent={active === 2} />
        <Route d="M570 320 C650 320 655 235 720 235" visible={active >= 3} accent={active === 3} />
        <Route d="M770 235 L895 235" visible={active >= 4} accent={active === 4} />
        <Route d="M830 265 C805 390 760 440 700 470" visible={active >= 5} accent={active === 5} />
        <Route d="M700 470 L885 470" visible={active >= 5} />
        <Route d="M700 470 C620 560 500 590 420 520" visible={active >= 6} accent={active === 6} />
      </svg>

      <motion.div className="cinema-signal" animate={{ left: point.left, top: point.top }} transition={{ duration: reduceMotion ? 0 : .7, ease: [0.22, 1, 0.36, 1] }} />

      <motion.div className="cinema-workspace" animate={{ opacity: 1, scale: active === 0 ? 1.06 : 1 }}>
        <div className="workspace-ring"><div className="workspace-ring"><div className="workspace-core">OR</div></div></div>
        <span>WORKSPACE / 01</span><strong>ACTIVE</strong><small>PRINCIPAL BOUND</small>
      </motion.div>

      <motion.div className="cinema-path" animate={{ opacity: active >= 1 ? 1 : .16, y: active === 1 ? -5 : 0 }}>
        <span>PATH / 04</span><strong>ACTIVE AUTHORITY</strong>
        <div>{['ACTION', 'ASSET', 'PARTY', 'EXPOSURE', 'VELOCITY', 'DURATION'].map((x, i) => <i key={x} className={active === 1 && i < 4 ? 'hot' : ''} title={x} />)}</div>
      </motion.div>

      <motion.div className="cinema-baphomet" animate={{ opacity: active >= 2 ? 1 : .12, scale: active === 2 ? 1.04 : 1 }}>
        <span>BAPHOMET</span><strong>{active >= 2 ? 'ALLOW' : 'WAITING'}</strong>
        <div className="policy-checks">{['WORKSPACE', 'AGENT', 'PATH', 'EXPOSURE'].map((x, i) => <b key={x} className={active === 2 && i <= 3 ? 'pass' : ''}>{x}<em>{active >= 2 ? 'PASS' : '—'}</em></b>)}</div>
      </motion.div>

      <motion.div className="cinema-pact" animate={{ opacity: active >= 3 ? 1 : .08, scale: active === 3 ? 1.03 : 1 }}>
        <motion.i className="pact-sheet sheet-a" animate={{ x: active >= 3 ? 0 : -22, y: active >= 3 ? 0 : -12 }} />
        <motion.i className="pact-sheet sheet-b" animate={{ x: active >= 3 ? 0 : 20, y: active >= 3 ? 0 : 14 }} />
        <span>PACT / 2048</span><strong>{active >= 3 ? 'SEALED' : 'FORMING'}</strong><small>420 USDC / 6 HOURS</small>
      </motion.div>

      <motion.div className="cinema-proof" animate={{ opacity: active >= 4 ? 1 : .08 }}>
        <span>PROOF</span><div>{[0,1,2].map((i) => <motion.i key={i} animate={{ scale: active === 4 && i === 1 ? 1.3 : 1 }} className={active >= 4 && i < 2 ? 'verified' : ''}><b>0{i+1}</b></motion.i>)}</div><small>{active >= 4 ? '02 OF 03 VERIFIED' : 'CHECKPOINTS CLOSED'}</small>
      </motion.div>

      <motion.div className="cinema-settlement" animate={{ opacity: active >= 5 ? 1 : .07, scale: active === 5 ? 1.03 : 1 }}>
        <span>STN-DELTA</span><strong>ROUTING</strong><div><b>EARNED<em>210</em></b><b>RESIDUAL<em>210</em></b></div><small>USDC</small>
      </motion.div>
      <motion.div className="cinema-receipt" animate={{ opacity: active >= 5 ? 1 : .06 }}><span>ARC RECEIPT</span><strong>CONFIRMED</strong><small>CHAIN 5042002</small></motion.div>
      <motion.div className="cinema-gaia" animate={{ opacity: active >= 6 ? 1 : .05, scale: active === 6 ? 1.05 : 1 }}><span>GAIA / 018</span><strong>RECTIFIED</strong><small>HISTORY PRESERVED</small></motion.div>
    </div>
  );
}

export function LifecycleStory() {
  const ref = useRef<HTMLElement | null>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end end'] });
  useMotionValueEvent(scrollYProgress, 'change', (value) => setActive(Math.min(chapters.length - 1, Math.floor(value * chapters.length))));
  const chapter = chapters[active];
  const jumpTo = (index: number) => {
    if (!ref.current) return;
    const start = window.scrollY + ref.current.getBoundingClientRect().top;
    const distance = Math.max(0, ref.current.offsetHeight - window.innerHeight);
    window.scrollTo({ top: start + (index / (chapters.length - 1)) * distance, behavior: 'smooth' });
  };

  return (
    <section ref={ref} id="lifecycle-story" className="cinematic-scroll" aria-label="OpenRails lifecycle narrative">
      <div className="cinematic-sticky">
        <div className="cinematic-copy">
          <div className="cinematic-copy-head"><span className="tech-label">OPENRAILS / LIFECYCLE</span><strong>{chapter.index} / 07</strong></div>
          <AnimatePresence mode="wait">
            <motion.div key={chapter.id} initial={{ opacity: 0, y: 22 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -16 }} transition={{ duration: .38 }}>
              <span className="chapter-label">{chapter.label}</span>
              <h2>{chapter.title}</h2>
              <p>{chapter.copy}</p>
              <div className="chapter-facts">{chapter.facts.map((fact) => <span key={fact}>{fact}</span>)}</div>
            </motion.div>
          </AnimatePresence>
          <div className="cinematic-index">{chapters.map((item, index) => <button key={item.id} className={index === active ? 'active' : index < active ? 'complete' : ''} onClick={() => jumpTo(index)} aria-label={item.label}><i /></button>)}</div>
        </div>
        <div className="cinematic-stage">
          <div className="stage-head"><span>LIVE SYSTEM MODEL</span><strong>SCROLL TO COORDINATE</strong></div>
          <LifecycleMachine active={active} />
          <div className="stage-event"><span>{`13:${20 + active}:0${active}`}</span><strong>{chapter.event}</strong><i>RECORDED</i></div>
        </div>
      </div>
    </section>
  );
}
