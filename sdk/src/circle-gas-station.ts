import { ethers } from "ethers";
import {
  assertValidSchema,
  OPENRAILS_SHARED_INTERFACE_VERSION,
  SHARED_INTERFACE_SCHEMA_BASE_URL,
} from "./shared-interface";
import {
  bindReceiptToCanonicalRecord,
  withSettlementReference,
  verifyCanonicalRecord,
} from "./canonical-record";
import { prepareWalletHandoff } from "./wallet-handoff";
import type {
  CanonicalRecord,
  CapabilityDeclaration,
  CapabilityStatus,
  Hash,
  NetworkReference,
  ObjectRef,
  Receipt,
  Timestamp,
  WalletHandoff,
  WorkspaceRef,
  PathRef,
  IntentRef,
  ProposalRef,
  PactRef,
} from "./generated/shared-interface";

export const CIRCLE_ARC_TESTNET_CHAIN = "ARC-TESTNET" as const;
export const CIRCLE_ARC_TESTNET_CHAIN_ID = "5042002" as const;
export const CIRCLE_ARC_TESTNET_NETWORK_ID = "arc-testnet" as const;
/** Circle's documented Gas Station contract for Arc Testnet. */
export const CIRCLE_GAS_STATION_CONTRACT_ADDRESS = "0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25" as const;
export const CIRCLE_GAS_STATION_CAPABILITY = "circle.gas-station.contract-execution" as const;

export interface CircleGasStationCallRequest {
  accountType: "SCA";
  chain: typeof CIRCLE_ARC_TESTNET_CHAIN;
  chainId: typeof CIRCLE_ARC_TESTNET_CHAIN_ID;
  walletId: string;
  walletAddress: string;
  contractAddress: string;
  calldata: string;
  value: string;
  gasStationContractAddress: typeof CIRCLE_GAS_STATION_CONTRACT_ADDRESS;
}

/**
 * Host-owned Circle integration seam. The implementation should call the
 * official Circle Wallets API or SDK. It receives no private key and this
 * interface has no submit or broadcast method.
 */
export interface CircleGasStationRuntime {
  prepareContractCall(request: CircleGasStationCallRequest): Promise<{
    requestId: string;
    providerStatus?: string;
  }>;
}

export interface CircleGasStationAdapterOptions {
  /** True only when the host has resolved real Circle Console credentials. */
  credentialsPresent: boolean;
  runtime?: CircleGasStationRuntime;
}

export interface CircleGasStationCapability {
  capability: typeof CIRCLE_GAS_STATION_CAPABILITY;
  status: Extract<CapabilityStatus, "UNAVAILABLE" | "DEMONSTRATION">;
  chain: typeof CIRCLE_ARC_TESTNET_CHAIN;
  chainId: typeof CIRCLE_ARC_TESTNET_CHAIN_ID;
  accountType: "SCA";
  gasStationContractAddress: typeof CIRCLE_GAS_STATION_CONTRACT_ADDRESS;
  credentialsPresent: boolean;
  runtimePresent: boolean;
  liveExecutionProven: false;
  statusJustification: string;
}

export interface CircleGasStationPreparedCall {
  handoff: WalletHandoff;
  circle: {
    capability: CircleGasStationCapability;
    sponsorshipRequested: true;
    sponsorshipConfirmed: false;
    requestId: string | null;
    providerStatus: string | null;
    liveExecutionProven: false;
  };
}

export class CircleGasStationUnavailableError extends Error {
  readonly code = "CIRCLE_GAS_STATION_UNAVAILABLE" as const;

  constructor(message: string) {
    super(message);
    this.name = "CircleGasStationUnavailableError";
  }
}

export interface PrepareCircleGasStationCallParams {
  walletId: string;
  walletAddress: string;
  contractAddress: string;
  calldata: string;
  value?: string;
  operationId: string;
  correlationId?: string;
  handoffId?: string;
  expiresAt?: Timestamp;
  workspaceRef?: WorkspaceRef;
  pathRef?: PathRef;
  intentRef?: IntentRef;
  proposalRef?: ProposalRef;
  pactRef?: PactRef;
}

function address(value: string, field: string): string {
  if (!ethers.isAddress(value) || ethers.getAddress(value) === ethers.ZeroAddress) {
    throw new Error(`${field} must be a non-zero EVM address`);
  }
  return ethers.getAddress(value);
}

function nonNegativeInteger(value: string | undefined, field: string): string {
  const normalized = value ?? "0";
  if (!/^(0|[1-9][0-9]*)$/.test(normalized)) throw new Error(`${field} must be an unsigned decimal string`);
  return normalized;
}

function now(): Timestamp {
  return new Date().toISOString();
}

function network(): NetworkReference {
  return { networkId: CIRCLE_ARC_TESTNET_NETWORK_ID, chainId: CIRCLE_ARC_TESTNET_CHAIN_ID };
}

export class CircleGasStationAdapter {
  private readonly credentialsPresent: boolean;
  private readonly runtime?: CircleGasStationRuntime;

  constructor(options: CircleGasStationAdapterOptions) {
    this.credentialsPresent = options.credentialsPresent;
    this.runtime = options.runtime;
  }

  capability(): CircleGasStationCapability {
    const ready = this.credentialsPresent && Boolean(this.runtime);
    return {
      capability: CIRCLE_GAS_STATION_CAPABILITY,
      status: ready ? "DEMONSTRATION" : "UNAVAILABLE",
      chain: CIRCLE_ARC_TESTNET_CHAIN,
      chainId: CIRCLE_ARC_TESTNET_CHAIN_ID,
      accountType: "SCA",
      gasStationContractAddress: CIRCLE_GAS_STATION_CONTRACT_ADDRESS,
      credentialsPresent: this.credentialsPresent,
      runtimePresent: Boolean(this.runtime),
      liveExecutionProven: false,
      statusJustification: ready
        ? "An injected Circle runtime is available, but no live Arc transaction evidence is asserted by this adapter."
        : "Circle Console credentials and an injected Circle Wallets runtime are required before execution can be attempted.",
    };
  }

  capabilityDeclaration(observedAt: Timestamp = now()): CapabilityDeclaration {
    const capability = this.capability();
    return {
      interfaceVersion: OPENRAILS_SHARED_INTERFACE_VERSION,
      capability: capability.capability,
      status: capability.status,
      allowedExecutionProfiles: ["direct-wallet-authorized"],
      authorizationClasses: ["WALLET_TRANSACTION"],
      transactionBehavior: {
        kind: "wallet-transaction",
        submissionMeansFinancialSuccess: false,
        financialSuccessRequirement: "exact-receipt-and-vault-reconciliation",
      },
      statusJustification: capability.statusJustification,
      evidence: [],
      provenance: {
        authority: "openrails-sdk",
        evidenceLevel: "configuration-only",
        observedAt,
        source: "configuration",
        notes: "This declaration is separate from the OpenRails keeper relay and does not claim Circle execution.",
      },
    };
  }

  async prepare(params: PrepareCircleGasStationCallParams): Promise<CircleGasStationPreparedCall> {
    const walletAddress = address(params.walletAddress, "walletAddress");
    const contractAddress = address(params.contractAddress, "contractAddress");
    if (!params.walletId.trim()) throw new Error("walletId is required");
    if (!ethers.isHexString(params.calldata)) throw new Error("calldata must be hex data");

    const request: CircleGasStationCallRequest = {
      accountType: "SCA",
      chain: CIRCLE_ARC_TESTNET_CHAIN,
      chainId: CIRCLE_ARC_TESTNET_CHAIN_ID,
      walletId: params.walletId,
      walletAddress,
      contractAddress,
      calldata: params.calldata,
      value: nonNegativeInteger(params.value, "value"),
      gasStationContractAddress: CIRCLE_GAS_STATION_CONTRACT_ADDRESS,
    };
    const observedAt = now();
    const capability = this.capability();
    const runtimeResult = capability.status === "DEMONSTRATION" && this.runtime
      ? await this.runtime.prepareContractCall(request)
      : undefined;
    if (runtimeResult && !runtimeResult.requestId.trim()) throw new Error("Circle runtime returned an empty request id");

    const handoff = prepareWalletHandoff({
      id: params.handoffId ?? `circle-gas-station:${params.walletId}:${Date.now()}`,
      operationId: params.operationId,
      correlationId: params.correlationId ?? `circle-gas-station:${Date.now()}`,
      subject: { walletAddress },
      network: network(),
      preparedRequest: {
        kind: "evm-transaction",
        chainId: CIRCLE_ARC_TESTNET_CHAIN_ID,
        from: walletAddress,
        to: contractAddress,
        data: params.calldata,
        value: nonNegativeInteger(params.value, "value"),
      },
      expiresAt: params.expiresAt ?? new Date(Date.now() + 5 * 60_000).toISOString(),
      provenance: {
        authority: "openrails-circle-gas-station-adapter",
        evidenceLevel: runtimeResult ? "runtime-observed" : "configuration-only",
        observedAt,
        source: runtimeResult ? "runtime-evaluation" : "configuration",
        notes: "External Circle Wallets infrastructure remains responsible for authorization and execution.",
      },
      workspaceRef: params.workspaceRef,
      pathRef: params.pathRef,
      intentRef: params.intentRef,
      proposalRef: params.proposalRef,
      pactRef: params.pactRef,
      createdAt: observedAt,
      now: observedAt,
    });

    return {
      handoff,
      circle: {
        capability,
        sponsorshipRequested: true,
        sponsorshipConfirmed: false,
        requestId: runtimeResult?.requestId ?? null,
        providerStatus: runtimeResult?.providerStatus ?? null,
        liveExecutionProven: false,
      },
    };
  }
}

export interface CircleExecutionEvidence {
  transactionHash: Hash;
  transactionId?: string;
  transactionRef?: ObjectRef;
  eventRefs?: ObjectRef[];
  observedAt: Timestamp;
}

export interface BoundCircleExecutionEvidence<T extends Receipt = Receipt> {
  receipt: T;
  canonicalRecord?: CanonicalRecord;
  settlementReferences: Array<{ kind: "transaction" | "event"; reference: ObjectRef }>;
  canonicalRecordVerification?: ReturnType<typeof verifyCanonicalRecord>;
  requiresResignatures: boolean;
  evidence: CircleExecutionEvidence;
}

/** Bind Circle transaction and event references without upgrading them to live financial proof. */
export function bindCircleExecutionEvidence<T extends Receipt>(
  receipt: T,
  evidence: CircleExecutionEvidence,
  record?: CanonicalRecord,
): BoundCircleExecutionEvidence<T> {
  const transactionReference = evidence.transactionRef ?? {
    type: "TransactionState",
    id: evidence.transactionId ?? evidence.transactionHash,
    network: receipt.network,
  } satisfies ObjectRef;
  const settlementReferences = [
    { kind: "transaction" as const, reference: transactionReference },
    ...(evidence.eventRefs ?? []).map((reference) => ({ kind: "event" as const, reference })),
  ];

  let canonicalRecord = record;
  for (const reference of settlementReferences) {
    if (!canonicalRecord?.settlementReferences.some((existing) =>
      existing.kind === reference.kind && existing.reference.id === reference.reference.id)) {
      if (canonicalRecord) {
        canonicalRecord = withSettlementReference(canonicalRecord, reference);
      }
    }
  }
  const canonicalRecordVerification = canonicalRecord
    ? verifyCanonicalRecord(canonicalRecord)
    : undefined;
  return {
    receipt: record ? bindReceiptToCanonicalRecord(receipt, record) : receipt,
    canonicalRecord,
    settlementReferences,
    canonicalRecordVerification,
    requiresResignatures: Boolean(canonicalRecord && !canonicalRecordVerification?.valid),
    evidence,
  };
}

export const CIRCLE_GAS_STATION_SCHEMA_BASE_URL = `${SHARED_INTERFACE_SCHEMA_BASE_URL}/circle-gas-station` as const;

export function assertCircleArcTestnetNetwork(chainId: string): void {
  assertValidSchema(`${SHARED_INTERFACE_SCHEMA_BASE_URL}/common.schema.json#/$defs/ChainId`, chainId);
  if (chainId !== CIRCLE_ARC_TESTNET_CHAIN_ID) throw new Error("Circle Gas Station adapter only supports Arc Testnet");
}
