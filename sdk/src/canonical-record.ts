import { ethers } from "ethers";
import {
  assertValidSchema,
  OPENRAILS_SHARED_INTERFACE_VERSION,
  SHARED_INTERFACE_SCHEMA_BASE_URL,
} from "./shared-interface";
import type {
  ActorRef,
  CapabilityDeclaration,
  CanonicalRecord,
  CanonicalRecordPolicy,
  CanonicalRecordRef,
  Hash,
  ObjectRef,
  Pact,
  Provenance,
  Receipt,
  Timestamp,
} from "./generated/shared-interface";

export const CANONICAL_RECORD_SCHEMA = `${SHARED_INTERFACE_SCHEMA_BASE_URL}/canonical-record.schema.json` as const;

const BILATERAL_SIGNATURE_REQUIREMENT = "bilateral-typed-actor-signatures" as const;

export const OMITTED_CANONICAL_RECORD_POLICY: CanonicalRecordPolicy = {
  mode: "omitted",
  exposure: "encrypted",
  signatureRequirement: BILATERAL_SIGNATURE_REQUIREMENT,
};

export const CANONICAL_RECORD_CAPABILITY = "canonical-record.policy" as const;

export function canonicalRecordCapabilityDeclaration(observedAt: Timestamp = new Date().toISOString()): CapabilityDeclaration {
  return {
    interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
    capability: CANONICAL_RECORD_CAPABILITY,
    status: "VERIFIED",
    allowedExecutionProfiles: ["direct-wallet-authorized", "delegated-runtime"],
    authorizationClasses: ["PUBLIC_READ"],
    transactionBehavior: {
      kind: "read-only",
      submissionMeansFinancialSuccess: false,
      financialSuccessRequirement: "none",
    },
    statusJustification: "Canonical Record policy and bilateral signature commitment validation are implemented in the SDK.",
    evidence: ["sdk:canonical-record-policy"],
    provenance: {
      authority: "openrails-sdk",
      evidenceLevel: "repository-asserted",
      observedAt,
      source: "repository-evidence",
      notes: "This capability is separate from Vault financial state. Cryptographic actor verification requires an application-supplied verifier.",
    },
  };
}

function normalize(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const child = (value as Record<string, unknown>)[key];
      if (child !== undefined) output[key] = normalize(child);
    }
    return output;
  }
  return value;
}

export function canonicalizeRecordValue(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function hashCanonicalRecordValue(value: unknown): Hash {
  return ethers.keccak256(ethers.toUtf8Bytes(canonicalizeRecordValue(value)));
}

/** The exact signed payload excludes signatures so both actors sign the same commitment. */
export function canonicalRecordEnvelopeCommitment(record: Pick<CanonicalRecord,
  "pactRef" | "sequence" | "previousCommitment" | "plaintextCommitment" | "ciphertextHash" | "encryption" | "encryptedKeys" | "storageLocators" | "settlementReferences"
>): Hash {
  return hashCanonicalRecordValue({
    pactRef: record.pactRef,
    sequence: record.sequence,
    previousCommitment: record.previousCommitment,
    plaintextCommitment: record.plaintextCommitment,
    ciphertextHash: record.ciphertextHash,
    encryption: record.encryption,
    encryptedKeys: record.encryptedKeys,
    storageLocators: record.storageLocators,
    settlementReferences: record.settlementReferences,
  });
}

export interface CreateCanonicalRecordParams extends Omit<CanonicalRecord, "interfaceVersion"> {
  interfaceVersion?: CanonicalRecord["interfaceVersion"];
}

export function createCanonicalRecord(params: CreateCanonicalRecordParams): CanonicalRecord {
  const record: CanonicalRecord = {
    interfaceVersion: params.interfaceVersion ?? OPENRAILS_SHARED_INTERFACE_VERSION,
    ...params,
  };
  return assertValidSchema(CANONICAL_RECORD_SCHEMA, record);
}

export function canonicalRecordRef(
  record: Pick<CanonicalRecord, "id"> | CanonicalRecordRef,
  network?: CanonicalRecordRef["network"],
): CanonicalRecordRef {
  const recordNetwork = "network" in record
    ? record.network as CanonicalRecordRef["network"]
    : network;
  return {
    type: "CanonicalRecord",
    id: record.id,
    ...(recordNetwork ? { network: recordNetwork } : {}),
  };
}

export function resolveCanonicalRecordPolicy(pact: Pick<Pact, "canonicalRecordPolicy">): CanonicalRecordPolicy {
  return pact.canonicalRecordPolicy
    ? { ...pact.canonicalRecordPolicy }
    : { ...OMITTED_CANONICAL_RECORD_POLICY };
}

export function assertCanonicalRecordPolicy(
  pact: Pick<Pact, "canonicalRecordPolicy"> & Partial<Pick<Pact, "parties">>,
  record?: CanonicalRecord,
): CanonicalRecord | undefined {
  const policy = resolveCanonicalRecordPolicy(pact);
  if (policy.mode === "omitted") {
    if (record) throw new Error("Pact policy omits Canonical Records");
    return undefined;
  }
  if (!record) {
    if (policy.mode === "required") throw new Error("Pact requires a Canonical Record");
    return undefined;
  }
  assertValidCanonicalRecord(record, policy, pact.parties);
  return record;
}

export interface CanonicalRecordVerification {
  valid: boolean;
  errors: string[];
  commitment: Hash;
  signatureVerification: "NOT_PERFORMED" | "VERIFIED" | "FAILED";
}

export interface CanonicalRecordSignatureVerificationInput {
  record: CanonicalRecord;
  actorRef: ActorRef;
  signature: CanonicalRecord["signatures"][number];
  commitment: Hash;
}

export type CanonicalRecordSignatureVerifier = (
  input: CanonicalRecordSignatureVerificationInput,
) => boolean | Promise<boolean>;

function actorKey(actor: ActorRef): string {
  return [actor.network?.networkId ?? "", actor.network?.chainId ?? "", actor.id.toLowerCase()].join(":");
}

export function verifyCanonicalRecord(
  record: CanonicalRecord,
  policy?: CanonicalRecordPolicy,
  counterparties?: readonly ActorRef[],
): CanonicalRecordVerification {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return {
      valid: false,
      errors: ["Canonical Record must be an object"],
      commitment: ethers.ZeroHash as Hash,
      signatureVerification: "NOT_PERFORMED",
    };
  }
  const errors: string[] = [];
  try {
    assertValidSchema(CANONICAL_RECORD_SCHEMA, record);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const commitment = canonicalRecordEnvelopeCommitment(record);
  const actorIds = new Set<string>();
  const signatures = Array.isArray(record.signatures) ? record.signatures : [];
  for (const signature of signatures) {
    if (!signature || typeof signature !== "object" || !signature.actorRef || typeof signature.actorRef.id !== "string") continue;
    const key = actorKey(signature.actorRef);
    if (actorIds.has(key)) errors.push("Canonical Record signatures must be from distinct actors");
    actorIds.add(key);
    if (!ethers.isHexString(signature.signature) || ethers.dataLength(signature.signature) === 0) {
      errors.push(`Canonical Record signature for ${signature.actorRef.id} must contain signature bytes`);
    }
    if (signature.signedCommitment.toLowerCase() !== commitment.toLowerCase()) {
      errors.push(`Canonical Record signature for ${signature.actorRef.id} is bound to a different commitment`);
    }
  }

  const keyIds = new Set<string>();
  const encryptedKeys = Array.isArray(record.encryptedKeys) ? record.encryptedKeys : [];
  for (const encryptedKey of encryptedKeys) {
    if (!encryptedKey || typeof encryptedKey !== "object" || !encryptedKey.counterpartyRef || typeof encryptedKey.counterpartyRef.id !== "string") continue;
    const key = actorKey(encryptedKey.counterpartyRef);
    if (keyIds.has(key)) errors.push("Canonical Record encrypted keys must cover distinct counterparties");
    keyIds.add(key);
  }

  if (policy) {
    if (policy.mode === "omitted") errors.push("Canonical Record is present but the Pact policy omits records");
    const exposure = record.encryption && typeof record.encryption === "object"
      ? (record.encryption as { mode?: unknown }).mode
      : undefined;
    if (policy.exposure !== exposure) {
      errors.push(`Canonical Record exposure ${String(exposure)} does not match Pact policy ${policy.exposure}`);
    }
  }

  const exposure = record.encryption && typeof record.encryption === "object"
    ? (record.encryption as { mode?: unknown }).mode
    : undefined;
  if (exposure === "public" && encryptedKeys.length !== 0) {
    errors.push("Public Canonical Records must not contain encrypted counterparty keys");
  }

  if (counterparties) {
    const expectedActors = new Set(counterparties.map(actorKey));
    if (expectedActors.size !== 2) errors.push("A bilateral Canonical Record requires exactly two distinct Pact parties");
    for (const expected of expectedActors) {
      if (!actorIds.has(expected)) errors.push("Canonical Record signatures must cover both Pact parties");
      if (exposure === "encrypted" && !keyIds.has(expected)) {
        errors.push("Encrypted Canonical Record keys must cover both Pact parties");
      }
    }
    for (const signer of actorIds) {
      if (!expectedActors.has(signer)) errors.push("Canonical Record contains a signature from an actor outside the Pact");
    }
    if (exposure === "encrypted") {
      for (const keyHolder of keyIds) {
        if (!expectedActors.has(keyHolder)) errors.push("Canonical Record contains an encrypted key for an actor outside the Pact");
      }
    }
  }

  return { valid: errors.length === 0, errors, commitment, signatureVerification: "NOT_PERFORMED" };
}

export async function verifyCanonicalRecordSignatures(
  record: CanonicalRecord,
  verifier: CanonicalRecordSignatureVerifier,
  policy?: CanonicalRecordPolicy,
  counterparties?: readonly ActorRef[],
): Promise<CanonicalRecordVerification> {
  const result = verifyCanonicalRecord(record, policy, counterparties);
  if (!result.valid) return { ...result, signatureVerification: "FAILED" };

  const errors = [...result.errors];
  for (const signature of record.signatures) {
    let verified = false;
    try {
      verified = await verifier({ record, actorRef: signature.actorRef, signature, commitment: result.commitment });
    } catch (error) {
      errors.push(`Canonical Record signature verifier failed for ${signature.actorRef.id}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (!verified) errors.push(`Canonical Record signature is invalid for ${signature.actorRef.id}`);
  }

  return {
    ...result,
    valid: errors.length === 0,
    errors,
    signatureVerification: errors.length === 0 ? "VERIFIED" : "FAILED",
  };
}

export function assertValidCanonicalRecord(
  record: CanonicalRecord,
  policy?: CanonicalRecordPolicy,
  counterparties?: readonly ActorRef[],
): CanonicalRecord {
  const result = verifyCanonicalRecord(record, policy, counterparties);
  if (!result.valid) throw new Error(result.errors.join("; "));
  return record;
}

/** Attach a record reference to a receipt without treating the record as Vault state. */
export function bindReceiptToCanonicalRecord<T extends Receipt>(
  receipt: T,
  record: Pick<CanonicalRecord, "id"> | CanonicalRecordRef,
): T {
  return {
    ...receipt,
    canonicalRecordRef: canonicalRecordRef(record),
  } as T;
}

export interface CanonicalSettlementReference {
  kind: "vault" | "receipt" | "transaction" | "event";
  reference: ObjectRef;
  amount?: string;
}

/** Add an evidence reference before signatures are produced for the record. */
export function withSettlementReference(
  record: CanonicalRecord,
  reference: CanonicalSettlementReference,
): CanonicalRecord {
  return createCanonicalRecord({
    ...record,
    settlementReferences: [...record.settlementReferences, reference],
  });
}

export function recordSignatureCommitment(record: CanonicalRecord): Hash {
  return canonicalRecordEnvelopeCommitment(record);
}

export type CanonicalRecordActorRef = ActorRef;
export type CanonicalRecordProvenance = Provenance;
export type CanonicalRecordTimestamp = Timestamp;
