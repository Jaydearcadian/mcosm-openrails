import transitionRules from "../registries/transition-rules.json" with { type: "json" };

export function isAllowedTransition({ from, to, trigger, executionProfile }) {
  return transitionRules.allowedTransitions.some((rule) =>
    rule.from === from &&
    rule.to === to &&
    rule.trigger === trigger &&
    rule.allowedProfiles.includes(executionProfile)
  );
}

export function hasValidProfileReferences(value) {
  if (value.executionProfile === "delegated-runtime") {
    const required = ["workspaceRef", "pathRef", "intentRef", "proposalRef"];
    if (!required.every((key) => value[key] !== undefined)) return false;
    const isBlocked = value.lifecycleState === "BLOCKED" || value.decision === "BLOCK";
    return isBlocked ? value.pactRef === undefined : value.pactRef !== undefined;
  }
  if (value.executionProfile !== "direct-wallet-authorized") return false;
  if (value.pathRef !== undefined && value.workspaceRef === undefined) return false;
  if (value.proposalRef !== undefined && value.intentRef === undefined) return false;
  if (value.pactRef !== undefined && value.proposalRef === undefined) return false;
  return true;
}

export function hasValidProofPlacement({ gate, requiredGate, beforeTransition }) {
  const effectiveGate = gate ?? requiredGate;
  const allowed = {
    NONE: ["NONE"],
    AUTHORIZATION: ["WALLET_SETTLEMENT_INTENT_AUTHORIZATION", "PAYER_SIGNATURE_AND_ISSUANCE"],
    CLAIM: ["RECIPIENT_CLAIM"],
    CHECKPOINT: ["CHECKPOINT_SETTLEMENT"],
    FINAL_SETTLEMENT: ["SETTLEMENT"]
  };
  return (allowed[effectiveGate] ?? []).includes(beforeTransition);
}

export function outcomeRule(outcome) {
  const rule = transitionRules.outcomeRules.find((candidate) => candidate.outcome === outcome);
  if (!rule) throw new Error(`Unknown outcome ${outcome}`);
  return rule;
}
