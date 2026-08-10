import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

const runtimeNodes = [
  { id: "policy", index: "01", label: "POLICY EVALUATION", output: "ALLOW / BLOCK decision", copy: "Evaluates a proposal against Workspace state, assigned Path, and current economic exposure.", pos: "arch-1" },
  { id: "registry", index: "02", label: "ACTION REGISTRY", output: "Canonical action state", copy: "Tracks proposals, prepared actions, wallet confirmation boundaries, and observed outcomes.", pos: "arch-2" },
  { id: "pact", index: "03", label: "PACT STATE MACHINE", output: "Commercial lifecycle", copy: "Advances accepted terms through confirmation, performance, completion, exception, and closure.", pos: "arch-3" },
  { id: "verification", index: "04", label: "VERIFICATION PLUGINS", output: "Evidence result", copy: "Evaluates configured checkpoint evidence without pretending one verifier fits every commerce flow.", pos: "arch-4" },
  { id: "observer", index: "05", label: "ARC OBSERVER", output: "Canonical receipt", copy: "Observes Arc execution and advances state only after canonical transaction evidence is available.", pos: "arch-5" },
  { id: "gaia", index: "06", label: "GAIA", output: "Bounded rectification", copy: "Preserves history and applies authorized exception outcomes defined by the Pact.", pos: "arch-6" },
] as const;

const paths = [
  "M500 325 C350 280 270 210 180 145", "M500 325 C350 380 270 470 180 525",
  "M500 325 C650 280 730 210 820 145", "M500 325 C650 380 730 470 820 525",
  "M500 325 L500 90", "M500 325 L500 570",
];

export function RuntimeArchitecture() {
  const [active, setActive] = useState(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (reduceMotion) return;
    const timer = window.setInterval(() => setActive((value) => (value + 1) % runtimeNodes.length), 2700);
    return () => window.clearInterval(timer);
  }, [reduceMotion]);
  const detail = runtimeNodes[active];

  return <section className="runtime-section" aria-label="OpenRails Runtime architecture"><div className="architecture-map"><div className="runtime-map-head"><span>OPENRAILS RUNTIME / COORDINATION GRAPH</span><strong>NO PRIVATE KEYS</strong></div><svg className="architecture-routes" viewBox="0 0 1000 650" preserveAspectRatio="none" aria-hidden="true">{paths.map((path, index) => <motion.path key={path} d={path} pathLength="1" animate={{ pathLength: 1, opacity: index === active ? 1 : .28 }} transition={{ duration: reduceMotion ? 0 : .65 }} className={index === active ? "active" : ""} />)}</svg><motion.div className="runtime-core" animate={{ scale: 1.02 }} transition={{ repeat: reduceMotion ? 0 : Infinity, repeatType: "reverse", duration: 2.4 }}><span>OPENRAILS RUNTIME</span><strong>OR</strong><small>COORDINATION / NO PRIVATE KEYS</small></motion.div>{runtimeNodes.map((item, index) => <button type="button" className={`architecture-node ${item.pos} ${index === active ? "active" : ""}`} key={item.id} onClick={() => setActive(index)}><span>{item.index}</span><strong>{item.label}</strong><small>{item.output}</small></button>)}</div><motion.div className="runtime-detail" key={detail.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}><div><span>{detail.index} / ACTIVE COMPONENT</span><h3>{detail.label}</h3></div><p>{detail.copy}</p><div><span>OUTPUT</span><strong>{detail.output}</strong></div></motion.div></section>;
}
