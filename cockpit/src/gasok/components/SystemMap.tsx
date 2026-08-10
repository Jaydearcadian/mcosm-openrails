import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useEffect, useMemo, useState } from 'react';

type Mode = 'PERMITTED' | 'BLOCKED' | 'RECTIFIED';
type NodeId = 'workspace' | 'path' | 'proposal' | 'baphomet' | 'pact' | 'proof' | 'settlement' | 'receipt' | 'gaia';

type EventRecord = { time: string; label: string; node: NodeId; source: string };

const modeCopy: Record<Mode, { title: string; copy: string }> = {
  PERMITTED: { title: 'A permitted lifecycle.', copy: 'Authority passed. Commitment verified. Settlement confirmed on Arc.' },
  BLOCKED: { title: 'A proposal stopped before commitment.', copy: 'The requested exposure exceeded the active Path. No Pact formed and no value moved.' },
  RECTIFIED: { title: 'An exception closed without erasing history.', copy: 'A disputed checkpoint entered Gaia, produced bounded rectification, and closed the Pact accountably.' },
};

const nodeDetails: Record<NodeId, { label: string; title: string; state: string; source: string; description: string; metrics: string[] }> = {
  workspace: { label: 'WORKSPACE / 01', title: 'Programmable Commerce Environment', state: 'ACTIVE', source: 'DEMONSTRATION', description: 'The durable principal that owns the activity and contains its actors, applications, and agents.', metrics: ['PRINCIPAL / WORKSPACE CONTROLLER', 'ACTORS / 04', 'ACTIVE PATHS / 02'] },
  path: { label: 'PATH / 04', title: 'Delegated authority', state: 'ACTIVE', source: 'RECORDED', description: 'The explicit boundary governing action, asset, counterparty, exposure, velocity, duration, and concurrency.', metrics: ['EXPOSURE / ≤ 1,000 USDC', 'VELOCITY / ≤ 0.012 USDC/s', 'REVISION / 07'] },
  proposal: { label: 'PROPOSAL / 018', title: 'Requested commercial action', state: 'SUBMITTED', source: 'RECORDED', description: 'A bounded request from Execution Agent 03 to form a 420 USDC commitment under Path 04.', metrics: ['VALUE / 420 USDC', 'DURATION / 6 HOURS', 'HASH / 0x84…12'] },
  baphomet: { label: 'BAPHOMET', title: 'Policy evaluation', state: 'ALLOW', source: 'RECORDED', description: 'The deterministic policy result binding Proposal 018 to the exact Workspace, Path revision, and economic state evaluated.', metrics: ['CHECKS / 14 PASS', 'DECISION / ALLOW', 'HASH / 0x91…7A'] },
  pact: { label: 'PACT / 2048', title: 'Commercial commitment', state: 'IN PERFORMANCE', source: 'DEMONSTRATION', description: 'The sealed parties, terms, proof requirements, settlement rules, and Gaia exception policy.', metrics: ['VALUE / 420 USDC', 'PROOF / 03 CHECKPOINTS', 'TERMS / 0xA4…2F'] },
  proof: { label: 'PROOF / 02 OF 03', title: 'Evidence progression', state: 'VERIFIED', source: 'RECORDED', description: 'Evidence has satisfied two configured checkpoints and made 210 USDC settlement-eligible.', metrics: ['VERIFIED / 02', 'ELIGIBLE / 210 USDC', 'PLUGIN / PERFORMANCE V1'] },
  settlement: { label: 'SETTLEMENT', title: 'Financial progression', state: 'PREPARED', source: 'DEMONSTRATION', description: 'Payment authorization, Paycard, and Vault state prepare earned and residual routing.', metrics: ['EARNED / 210 USDC', 'RESIDUAL / 210 USDC', 'PAYCARD / PC-2048'] },
  receipt: { label: 'ARC RECEIPT', title: 'Canonical network evidence', state: 'CONFIRMED', source: 'LIVE ON ARC', description: 'The onchain receipt is the canonical evidence that the prepared financial action executed successfully.', metrics: ['CHAIN / 5042002', 'NETWORK / ARC TESTNET', 'STATUS / SUCCESS'] },
  gaia: { label: 'GAIA / 018', title: 'Bounded rectification', state: 'RECTIFIED', source: 'DEMONSTRATION', description: 'The exception layer preserves the evidence bundle, records an authorised determination, and closes the Pact.', metrics: ['CASE / 018', 'EARNED / 210 USDC', 'RESIDUAL / 210 USDC'] },
};

const events: Record<Mode, EventRecord[]> = {
  PERMITTED: [
    { time: '13:20:18', label: 'Workspace 01 activated', node: 'workspace', source: 'DEMO' },
    { time: '13:20:42', label: 'Path 04 assigned', node: 'path', source: 'RECORDED' },
    { time: '13:21:04', label: 'Proposal 018 submitted', node: 'proposal', source: 'RECORDED' },
    { time: '13:21:44', label: 'Baphomet recorded ALLOW', node: 'baphomet', source: 'RECORDED' },
    { time: '13:22:18', label: 'Pact 2048 activated', node: 'pact', source: 'DEMO' },
    { time: '15:19:46', label: 'Checkpoint 02 verified', node: 'proof', source: 'RECORDED' },
    { time: '16:52:08', label: 'Arc settlement confirmed', node: 'receipt', source: 'LIVE' },
  ],
  BLOCKED: [
    { time: '13:20:18', label: 'Workspace 01 active', node: 'workspace', source: 'DEMO' },
    { time: '13:20:42', label: 'Path 04 loaded', node: 'path', source: 'RECORDED' },
    { time: '13:21:04', label: 'Proposal 019 submitted', node: 'proposal', source: 'RECORDED' },
    { time: '13:21:05', label: 'Exposure projected at 1,100 USDC', node: 'path', source: 'RECORDED' },
    { time: '13:21:06', label: 'Baphomet recorded BLOCK', node: 'baphomet', source: 'RECORDED' },
  ],
  RECTIFIED: [
    { time: '16:42:12', label: 'Checkpoint 02 rejected', node: 'proof', source: 'RECORDED' },
    { time: '16:45:03', label: 'Gaia case 018 opened', node: 'gaia', source: 'DEMO' },
    { time: '16:47:03', label: 'Revised evidence attached', node: 'proof', source: 'RECORDED' },
    { time: '16:50:19', label: 'Determination recorded', node: 'gaia', source: 'DEMO' },
    { time: '16:52:08', label: 'Rectification confirmed on Arc', node: 'receipt', source: 'LIVE' },
  ],
};

const positionClass: Record<NodeId, string> = { workspace: 'map-workspace', path: 'map-path', proposal: 'map-proposal', baphomet: 'map-baphomet', pact: 'map-pact', proof: 'map-proof', settlement: 'map-settlement', receipt: 'map-receipt', gaia: 'map-gaia' };

export function SystemMap({ direct = false }: { direct?: boolean }) {
  const [mode, setMode] = useState<Mode>('PERMITTED');
  const [activeNode, setActiveNode] = useState<NodeId>('workspace');
  const [eventIndex, setEventIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [binding, setBinding] = useState(false);
  const reduceMotion = useReducedMotion();
  const detail = nodeDetails[activeNode];
  const modeEvents = events[mode];

  useEffect(() => { setEventIndex(0); setActiveNode(modeEvents[0].node); setPlaying(false); }, [mode, modeEvents]);
  useEffect(() => {
    setActiveNode(modeEvents[eventIndex].node);
    if (eventIndex >= modeEvents.length - 1) setPlaying(false);
  }, [eventIndex, modeEvents]);
  useEffect(() => {
    if (!playing || reduceMotion) return;
    const timer = window.setInterval(() => setEventIndex((current) => Math.min(current + 1, modeEvents.length - 1)), 1050);
    return () => window.clearInterval(timer);
  }, [playing, modeEvents, reduceMotion]);

  const visibleState = useMemo(() => mode === 'BLOCKED' ? { gaia: false } : mode === 'RECTIFIED' ? { gaia: true } : { gaia: false }, [mode]);
  const selectEvent = (index: number) => { setEventIndex(index); setActiveNode(modeEvents[index].node); setPlaying(false); };

  return (
    <section className={`system-experience ${direct ? 'system-direct' : ''}`} aria-labelledby="system-title">
      <div className="system-intro">
        <span className="tech-label">OPENRAILS / SYSTEM 01</span>
        <div><h2 id="system-title">From delegated authority to accountable settlement.</h2><p>{modeCopy[mode].copy}</p></div>
        <div className="mode-switch" aria-label="Lifecycle demonstration mode">{(['PERMITTED', 'BLOCKED', 'RECTIFIED'] as const).map((item, index) => <button key={item} className={mode === item ? 'active' : ''} onClick={() => setMode(item)}><span>0{index + 1}</span> {item}</button>)}</div>
      </div>

      <div className="system-toolbar">
        <button onClick={() => { setEventIndex(0); setActiveNode(modeEvents[0].node); setPlaying(true); }}><i className={playing ? 'pause-icon' : 'play-icon'} /> {playing ? 'Playing lifecycle' : 'Play lifecycle'}</button>
        <button className={binding ? 'active' : ''} onClick={() => setBinding((value) => !value)}>View lifecycle binding</button>
        <span>{modeEvents[eventIndex].time} / {modeEvents[eventIndex].label}</span>
      </div>

      <div className="system-workbench">
        <div className={`system-canvas mode-${mode.toLowerCase()}`}>
          <div className="canvas-header"><div><span>WORKSPACE / 01</span><strong>{modeCopy[mode].title}</strong></div><div><span>SOURCE</span><strong>CURATED + ARC EVIDENCE</strong></div></div>
          <div className="map-actors" aria-label="Workspace actors"><span><i /> OWNER</span><span><i /> OPERATOR</span><span><i /> APPLICATION</span><span><i /> AGENT</span></div>
          <svg className="map-connections" viewBox="0 0 1100 600" preserveAspectRatio="none" aria-hidden="true">
            <motion.path d="M160 285 L302 285" pathLength="1" animate={{ pathLength: 1 }} />
            <motion.path d="M356 285 L466 285" pathLength="1" animate={{ pathLength: 1 }} />
            <motion.path d="M520 285 L620 285" pathLength="1" animate={{ pathLength: 1 }} />
            <motion.path className={mode === 'BLOCKED' ? 'route-stopped' : ''} d="M674 285 C745 285 760 190 826 190" pathLength="1" animate={{ pathLength: mode === 'BLOCKED' ? .08 : 1 }} transition={{ duration: reduceMotion ? 0 : .7 }} />
            <motion.path d="M880 190 L962 190" pathLength="1" animate={{ pathLength: mode === 'BLOCKED' ? 0 : 1 }} />
            <motion.path d="M826 240 C800 350 760 410 690 430" pathLength="1" animate={{ pathLength: mode === 'BLOCKED' ? 0 : 1 }} />
            <motion.path d="M745 430 L880 430" pathLength="1" animate={{ pathLength: mode === 'BLOCKED' ? 0 : 1 }} />
            <motion.path d="M934 430 L1010 430" pathLength="1" animate={{ pathLength: mode === 'BLOCKED' ? 0 : 1 }} />
            <motion.path className="gaia-route" d="M745 430 C640 520 535 520 462 475" pathLength="1" animate={{ pathLength: visibleState.gaia ? 1 : .12, opacity: visibleState.gaia ? 1 : .18 }} />
          </svg>

          {(Object.keys(nodeDetails) as NodeId[]).map((id) => {
            const node = nodeDetails[id];
            const blockedHidden = mode === 'BLOCKED' && ['pact', 'proof', 'settlement', 'receipt', 'gaia'].includes(id);
            const gaiaMuted = id === 'gaia' && !visibleState.gaia;
            const currentEventNode = modeEvents[eventIndex].node === id;
            return <motion.button type="button" key={id} className={`map-node ${positionClass[id]} ${activeNode === id ? 'is-active' : ''} ${currentEventNode ? 'is-current' : ''} ${blockedHidden || gaiaMuted ? 'is-muted' : ''}`} onClick={() => setActiveNode(id)} animate={{ opacity: blockedHidden ? .16 : gaiaMuted ? .25 : 1, scale: currentEventNode ? 1.04 : activeNode === id ? 1.02 : 1 }}><span>{node.label}</span><strong>{mode === 'BLOCKED' && id === 'baphomet' ? 'BLOCK' : node.state}</strong><small>{node.source}</small></motion.button>;
          })}

          <AnimatePresence>{binding && <motion.div className="binding-overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><span>LIFECYCLE BINDING</span><div>{['PATH HASH','PROPOSAL HASH','DECISION HASH','PACT TERMS HASH','EVIDENCE HASH','PAYCARD ID','ARC RECEIPT'].map((item, i) => <div key={item}><b>0{i + 1}</b><strong>{item}</strong>{i < 6 && <i>↓</i>}</div>)}</div><button onClick={() => setBinding(false)}>Close binding</button></motion.div>}</AnimatePresence>
          <div className="canvas-legend"><span><i className="legend-current" /> CURRENT</span><span><i className="legend-recorded" /> RECORDED</span><span><i className="legend-live" /> LIVE ON ARC</span></div>
        </div>

        <AnimatePresence mode="wait"><motion.aside className="system-inspector" key={`${activeNode}-${mode}`} initial={reduceMotion ? false : { opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: .3 }}>
          <div className="inspector-head"><span>{detail.label}</span><small>{detail.source}</small></div><h3>{detail.title}</h3>
          <div className="inspector-state"><span>STATE</span><strong>{mode === 'BLOCKED' && activeNode === 'baphomet' ? 'BLOCK' : detail.state}</strong></div>
          <p>{detail.description}</p><div className="inspector-metrics">{detail.metrics.map((metric) => <span key={metric}>{metric}</span>)}</div>
          <div className="binding-chain"><span>BINDING</span><code>PATH HASH → PROPOSAL HASH → DECISION HASH → PACT TERMS → EVIDENCE → PAYCARD → ARC RECEIPT</code></div>
          <button className="inspector-action">Inspect complete record ↗</button>
        </motion.aside></AnimatePresence>
      </div>

      <div className="activity-rail" aria-label="Lifecycle activity">
        <div className="activity-title"><span>ACTIVITY / {mode}</span><strong>{eventIndex + 1} OF {modeEvents.length}</strong></div>
        <div className="activity-events">{modeEvents.map((event, index) => <button key={`${event.time}-${event.label}`} className={index === eventIndex ? 'active' : index < eventIndex ? 'complete' : ''} onClick={() => selectEvent(index)}><span>{event.time}</span><strong>{event.label}</strong><small>{event.source}</small></button>)}</div>
      </div>
    </section>
  );
}
