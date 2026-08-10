import {
  assertValidSchema,
  type Actor,
  type BaphometDecision,
  type CanonicalRecord,
  type Intent,
  type Pact,
  type Path,
  type Proof,
  type Proposal,
  type Provenance,
  type Workspace
} from "@openrails/shared-interface";

import { RuntimeError } from "./errors.js";

const SCHEMA_ROOT = "https://schemas.openrails.dev/openrails/1.2.0";

export const SHARED_INTERFACE_1_2_SCHEMA_IDS = {
  Workspace: `${SCHEMA_ROOT}/workspace.schema.json`,
  Actor: `${SCHEMA_ROOT}/actor.schema.json`,
  Path: `${SCHEMA_ROOT}/path.schema.json`,
  Intent: `${SCHEMA_ROOT}/intent.schema.json`,
  Proposal: `${SCHEMA_ROOT}/proposal.schema.json`,
  BaphometDecision: `${SCHEMA_ROOT}/decision.schema.json`,
  Pact: `${SCHEMA_ROOT}/pact.schema.json`,
  Proof: `${SCHEMA_ROOT}/proof.schema.json`,
  CanonicalRecord: `${SCHEMA_ROOT}/canonical-record.schema.json`,
  Provenance: `${SCHEMA_ROOT}/provenance.schema.json`
} as const;

type StoredSchemaType = {
  Workspace: Workspace;
  Actor: Actor;
  Path: Path;
  Intent: Intent;
  Proposal: Proposal;
  BaphometDecision: BaphometDecision;
  Pact: Pact;
  Proof: Proof;
  CanonicalRecord: CanonicalRecord;
  Provenance: Provenance;
};

export function assertValidStoredState<K extends keyof StoredSchemaType>(
  schema: K,
  value: unknown,
  label: string
): StoredSchemaType[K] {
  try {
    return assertValidSchema(SHARED_INTERFACE_1_2_SCHEMA_IDS[schema], value) as StoredSchemaType[K];
  } catch (error) {
    throw new RuntimeError("STATE_STALE", `${label} failed Shared Interface 1.2 schema validation.`, {
      details: { reason: error instanceof Error ? error.message : "stored schema validation failed" }
    });
  }
}
