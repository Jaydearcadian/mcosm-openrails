import { motion, useReducedMotion } from 'framer-motion';
import { useState } from 'react';

const actors = [
  { label: 'OWNER', className: 'hero-actor actor-owner' },
  { label: 'APPLICATION', className: 'hero-actor actor-app' },
  { label: 'AGENT', className: 'hero-actor actor-agent' },
  { label: 'COUNTERPARTY', className: 'hero-actor actor-party' },
];

export function CinematicHero({ onViewNetwork }: { onViewNetwork: () => void }) {
  const [entered, setEntered] = useState(false);
  const reduceMotion = useReducedMotion();

  const enter = () => {
    setEntered(true);
    window.setTimeout(() => {
      document.getElementById('lifecycle-story')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
    }, reduceMotion ? 0 : 1450);
  };

  return (
    <section className={`cinematic-hero ${entered ? 'is-entered' : ''}`} aria-labelledby="hero-title">
      <div className="hero-grid" aria-hidden="true" />
      <div className="hero-copy-block">
        <motion.span
          className="tech-label"
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
        >
          OPENRAILS / PROGRAMMABLE COMMERCE
        </motion.span>
        <motion.h1
          id="hero-title"
          initial={reduceMotion ? false : { opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.75, delay: 0.08 }}
        >
          Commerce is becoming programmable.
          <span>Its authority should be too.</span>
        </motion.h1>
        <motion.p
          className="hero-copy"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          OpenRails is the control, agreement, and settlement plane through which people,
          organisations, applications, and agents act on Arc under explicit authority,
          commercial terms, financial limits, and accountability.
        </motion.p>
        <motion.div
          className="hero-actions"
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.35 }}
        >
          <button className="primary" onClick={enter} disabled={entered}>
            {entered ? 'Workspace active' : 'Enter the system'} <b>↘</b>
          </button>
          <button className="text-action" onClick={onViewNetwork}>Open live Cockpit</button>
        </motion.div>
      </div>

      <div className="hero-system" aria-label="OpenRails authority system forming around a Workspace">
        <div className="hero-system-caption">
          <span>{entered ? 'WORKSPACE / ACTIVE' : 'SYSTEM / UNBOUND'}</span>
          <small>{entered ? 'AUTHORITY ROUTE OPEN' : 'NO CANONICAL PRINCIPAL'}</small>
        </div>

        <svg className="hero-lines" viewBox="0 0 760 560" role="img" aria-label="Actors binding to the OpenRails Workspace">
          <motion.path d="M90 110 C210 110 250 230 346 260" pathLength="1" initial={{ pathLength: 0.12, opacity: 0.3 }} animate={{ pathLength: entered ? 1 : 0.18, opacity: entered ? 1 : 0.3 }} transition={{ duration: 0.9, delay: 0.1 }} />
          <motion.path d="M675 104 C560 110 520 225 415 260" pathLength="1" initial={{ pathLength: 0.12, opacity: 0.3 }} animate={{ pathLength: entered ? 1 : 0.18, opacity: entered ? 1 : 0.3 }} transition={{ duration: 0.9, delay: 0.2 }} />
          <motion.path d="M110 462 C220 448 255 348 347 305" pathLength="1" initial={{ pathLength: 0.12, opacity: 0.3 }} animate={{ pathLength: entered ? 1 : 0.18, opacity: entered ? 1 : 0.3 }} transition={{ duration: 0.9, delay: 0.3 }} />
          <motion.path d="M650 468 C545 445 516 353 414 306" pathLength="1" initial={{ pathLength: 0.12, opacity: 0.3 }} animate={{ pathLength: entered ? 1 : 0.18, opacity: entered ? 1 : 0.3 }} transition={{ duration: 0.9, delay: 0.4 }} />
          <motion.path className="signal-path" d="M421 282 C510 282 590 282 730 282" pathLength="1" initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: entered ? 1 : 0, opacity: entered ? 1 : 0 }} transition={{ duration: 1.05, delay: 0.62 }} />
        </svg>

        {actors.map((actor, index) => (
          <motion.div
            key={actor.label}
            className={actor.className}
            animate={entered ? { opacity: 1, x: 0, y: 0 } : { opacity: 0.55, x: index % 2 ? 8 : -8, y: index < 2 ? -3 : 3 }}
            transition={{ duration: 0.55, delay: index * 0.08 }}
          >
            <i />
            <span>{actor.label}</span>
            <small>{entered ? ['OWNS', 'INTERFACES', 'ACTS FOR', 'INTERACTS'][index] : 'UNBOUND'}</small>
          </motion.div>
        ))}

        <motion.div
          className="workspace-machine"
          animate={entered ? { scale: 1, opacity: 1 } : { scale: 0.82, opacity: 0.55 }}
          transition={{ type: 'spring', stiffness: 90, damping: 16 }}
        >
          <motion.div className="machine-layer machine-outer" animate={{ rotate: entered ? 0 : -2 }}>
            <div className="machine-index">01</div>
            <motion.div className="machine-layer machine-middle" animate={{ rotate: entered ? 0 : 3 }}>
              <div className="machine-layer machine-inner">
                <span>OR</span>
              </div>
            </motion.div>
          </motion.div>
          <div className="machine-label">
            <strong>{entered ? 'WORKSPACE 01' : 'PRINCIPAL REQUIRED'}</strong>
            <span>{entered ? 'PROGRAMMABLE COMMERCE ENVIRONMENT' : 'AUTHORITY NOT ESTABLISHED'}</span>
          </div>
        </motion.div>

        <motion.div
          className="path-emergence"
          initial={{ opacity: 0, x: -25 }}
          animate={{ opacity: entered ? 1 : 0, x: entered ? 0 : -25 }}
          transition={{ duration: 0.65, delay: 0.92 }}
        >
          <span>PATH / 04</span>
          <small>ACTION · ASSET · PARTY · EXPOSURE · VELOCITY · DURATION</small>
        </motion.div>
      </div>

      <div className="hero-footnote">
        <span>OWN</span><i />
        <span>AUTHORISE</span><i />
        <span>COMMIT</span><i />
        <span>PROVE</span><i />
        <span>SETTLE</span><i />
        <span>RESOLVE</span>
      </div>
    </section>
  );
}
