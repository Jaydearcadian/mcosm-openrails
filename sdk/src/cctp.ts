import { ethers } from "ethers";

/** Circle CCTP V2 testnet configuration used by the prepare-only SDK boundary. */
export const CCTP_ARC_TESTNET = {
  networkId: "arc-testnet",
  chainId: "5042002",
  domain: 26,
  usdc: "0x3600000000000000000000000000000000000000",
  messageTransmitterV2: "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275",
  tokenMessengerV2: "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA",
  tokenMinterV2: "0xb43db544E2c27092c107639Ad201b3dEfAbcF192",
  messageV2: "0xbaC0179bB358A8936169a63408C8481D582390C4",
} as const;

export const CCTP_TESTNET_SOURCES = {
  sepolia: {
    networkId: "ethereum-sepolia",
    chainId: "11155111",
    domain: 0,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    tokenMessengerV2: CCTP_ARC_TESTNET.tokenMessengerV2,
  },
  baseSepolia: {
    networkId: "base-sepolia",
    chainId: "84532",
    domain: 6,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    tokenMessengerV2: CCTP_ARC_TESTNET.tokenMessengerV2,
  },
} as const;

/** Circle's sandbox attestation API for CCTP V2 testnet messages. */
export const CCTP_TESTNET_ATTESTATION_API = "https://iris-api-sandbox.circle.com" as const;

export type CctpSourceNetwork = keyof typeof CCTP_TESTNET_SOURCES;
export type CctpPaymentMode = "direct" | "streaming";
export type CctpFundingStatus = "PREPARED" | "BURN_CONFIRMED" | "ATTESTED" | "MINT_CONFIRMED";
export type CctpAttestationState = "PENDING" | "COMPLETE" | "FAILED" | "UNKNOWN";

export interface CctpWorkspaceRef {
  type: "Workspace";
  id: string;
}

export interface CctpWorkspaceFunding {
  protocol: "circle-cctp-v2";
  workspaceRef: CctpWorkspaceRef;
  sourceNetwork: string;
  sourceDomain: number;
  destinationNetwork: typeof CCTP_ARC_TESTNET.networkId;
  destinationDomain: typeof CCTP_ARC_TESTNET.domain;
  paymentMode: CctpPaymentMode;
  amountBaseUnits: string;
  mintRecipient: string;
  status: CctpFundingStatus;
  burnTransactionHash?: string;
  messageNonce?: string;
  mintTransactionHash?: string;
}

export interface CctpContractCall {
  to: string;
  data: string;
  value: "0";
  description: string;
}

export interface CctpFundingPlan {
  protocol: "circle-cctp-v2";
  source: (typeof CCTP_TESTNET_SOURCES)[CctpSourceNetwork];
  destination: typeof CCTP_ARC_TESTNET;
  amountBaseUnits: string;
  maxFeeBaseUnits: string;
  minFinalityThreshold: 1000 | 2000;
  mintRecipient: string;
  destinationCaller: string;
  calls: [CctpContractCall, CctpContractCall];
  workspaceFunding?: CctpWorkspaceFunding;
  execution: {
    signs: false;
    broadcasts: false;
    requiresCircleAttestation: true;
    next: "submit-source-calls-then-receive-attested-message-on-arc";
  };
}

export interface CctpReceiveMessagePlan {
  protocol: "circle-cctp-v2";
  destination: typeof CCTP_ARC_TESTNET;
  message: string;
  attestation: string;
  call: CctpContractCall;
  execution: {
    signs: false;
    broadcasts: false;
    consumesMessageNonce: true;
  };
}

export interface CctpAttestationStatus {
  protocol: "circle-cctp-v2";
  sourceDomain: number;
  transactionHash: string;
  status: CctpAttestationState;
  message?: string;
  attestation?: string;
  raw: unknown;
}

const ERC20_INTERFACE = new ethers.Interface([
  "function approve(address spender, uint256 amount) returns (bool)",
]);
const TOKEN_MESSENGER_INTERFACE = new ethers.Interface([
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
]);
const MESSAGE_TRANSMITTER_INTERFACE = new ethers.Interface([
  "function receiveMessage(bytes message, bytes attestation) returns (bool)",
]);

function address(value: string, field: string): string {
  if (!ethers.isAddress(value) || ethers.getAddress(value) === ethers.ZeroAddress) {
    throw new Error(`${field} must be a non-zero EVM address`);
  }
  return ethers.getAddress(value);
}

function positiveAmount(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value <= 0n) throw new Error(`${field} must be a positive bigint`);
  return value;
}

function nonNegativeAmount(value: bigint, field: string): bigint {
  if (typeof value !== "bigint" || value < 0n) throw new Error(`${field} must be a non-negative bigint`);
  return value;
}

function bytes32Address(value: string, field: string): string {
  return ethers.zeroPadValue(address(value, field), 32);
}

function nonEmptyHex(value: string, field: string): string {
  if (!ethers.isHexString(value) || value === "0x") throw new Error(`${field} must be non-empty hex data`);
  return value;
}

function normalizeWorkspaceRef(value: CctpWorkspaceRef | undefined): CctpWorkspaceRef | undefined {
  if (!value) return undefined;
  if (value.type !== "Workspace" || !value.id.trim()) throw new Error("workspaceRef must identify a Workspace");
  return { type: "Workspace", id: value.id.trim() };
}

function paymentMode(value: CctpPaymentMode | undefined): CctpPaymentMode {
  if (value !== undefined && value !== "direct" && value !== "streaming") {
    throw new Error("paymentMode must be direct or streaming");
  }
  return value ?? "direct";
}

function fundingStatus(value: CctpFundingStatus): CctpFundingStatus {
  if (!['PREPARED', 'BURN_CONFIRMED', 'ATTESTED', 'MINT_CONFIRMED'].includes(value)) {
    throw new Error("status must be PREPARED, BURN_CONFIRMED, ATTESTED, or MINT_CONFIRMED");
  }
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
  return value;
}

function supportedSource(networkId: string, domain: number): void {
  const match = Object.values(CCTP_TESTNET_SOURCES).some((source) => (
    source.networkId === networkId && source.domain === domain
  ));
  if (!match) throw new Error("sourceNetwork and sourceDomain must match a supported CCTP testnet source");
}

function transactionHash(value: string | undefined, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (!ethers.isHexString(value, 32)) throw new Error(`${field} must be a 32-byte transaction hash`);
  return value;
}

function attestationState(value: unknown): CctpAttestationState {
  if (value === "complete") return "COMPLETE";
  if (value === "pending") return "PENDING";
  if (value === "failed") return "FAILED";
  return "UNKNOWN";
}

/**
 * Build the source-chain approve and CCTP V2 burn calls without signing or
 * broadcasting. The minted USDC is sent to the party's Arc wallet, after
 * which the normal OpenRails direct or streaming flow can run unchanged.
 */
export function prepareCctpFunding(params: {
  source: CctpSourceNetwork;
  amountBaseUnits: bigint;
  mintRecipient: string;
  destinationCaller?: string;
  maxFeeBaseUnits: bigint;
  minFinalityThreshold?: 1000 | 2000;
  workspaceRef?: CctpWorkspaceRef;
  paymentMode?: CctpPaymentMode;
}): CctpFundingPlan {
  const source = CCTP_TESTNET_SOURCES[params.source];
  if (!source) throw new Error(`Unsupported CCTP testnet source: ${String(params.source)}`);
  const amount = positiveAmount(params.amountBaseUnits, "amountBaseUnits");
  const maxFee = nonNegativeAmount(params.maxFeeBaseUnits, "maxFeeBaseUnits");
  if (maxFee > amount) throw new Error("maxFeeBaseUnits cannot exceed amountBaseUnits");
  const mintRecipientAddress = address(params.mintRecipient, "mintRecipient");
  const mintRecipient = ethers.zeroPadValue(mintRecipientAddress, 32);
  const destinationCaller = params.destinationCaller
    ? bytes32Address(params.destinationCaller, "destinationCaller")
    : ethers.ZeroHash;
  const minFinalityThreshold = params.minFinalityThreshold ?? 2000;
  if (minFinalityThreshold !== 1000 && minFinalityThreshold !== 2000) {
    throw new Error("minFinalityThreshold must be 1000 or 2000");
  }
  const workspace = normalizeWorkspaceRef(params.workspaceRef);
  const selectedPaymentMode = paymentMode(params.paymentMode);
  const approveData = ERC20_INTERFACE.encodeFunctionData("approve", [source.tokenMessengerV2, amount]);
  const burnData = TOKEN_MESSENGER_INTERFACE.encodeFunctionData("depositForBurn", [
    amount,
    CCTP_ARC_TESTNET.domain,
    mintRecipient,
    source.usdc,
    destinationCaller,
    maxFee,
    minFinalityThreshold,
  ]);
  const workspaceFunding = workspace
    ? {
        protocol: "circle-cctp-v2" as const,
        workspaceRef: workspace,
        sourceNetwork: source.networkId,
        sourceDomain: source.domain,
        destinationNetwork: CCTP_ARC_TESTNET.networkId,
        destinationDomain: CCTP_ARC_TESTNET.domain,
        paymentMode: selectedPaymentMode,
        amountBaseUnits: amount.toString(),
        mintRecipient: mintRecipientAddress,
        status: "PREPARED" as const,
      }
    : undefined;
  return {
    protocol: "circle-cctp-v2",
    source,
    destination: CCTP_ARC_TESTNET,
    amountBaseUnits: amount.toString(),
    maxFeeBaseUnits: maxFee.toString(),
    minFinalityThreshold,
    mintRecipient,
    destinationCaller,
    calls: [
      { to: source.usdc, data: approveData, value: "0", description: "Approve TokenMessengerV2 to burn source USDC" },
      { to: source.tokenMessengerV2, data: burnData, value: "0", description: "Burn source USDC for an Arc Testnet mint" },
    ],
    ...(workspaceFunding ? { workspaceFunding } : {}),
    execution: {
      signs: false,
      broadcasts: false,
      requiresCircleAttestation: true,
      next: "submit-source-calls-then-receive-attested-message-on-arc",
    },
  };
}

/** Build the Arc destination call after Circle has returned a message and attestation. */
export function prepareCctpReceiveMessage(params: { message: string; attestation: string }): CctpReceiveMessagePlan {
  const message = nonEmptyHex(params.message, "message");
  const attestation = nonEmptyHex(params.attestation, "attestation");
  return {
    protocol: "circle-cctp-v2",
    destination: CCTP_ARC_TESTNET,
    message,
    attestation,
    call: {
      to: CCTP_ARC_TESTNET.messageTransmitterV2,
      data: MESSAGE_TRANSMITTER_INTERFACE.encodeFunctionData("receiveMessage", [message, attestation]),
      value: "0",
      description: "Submit Circle's attested CCTP message to Arc MessageTransmitterV2",
    },
    execution: { signs: false, broadcasts: false, consumesMessageNonce: true },
  };
}

/**
 * Read Circle's CCTP V2 attestation state after a source-chain burn. This is
 * deliberately GET-only: it does not sign, broadcast, mint, or mutate a
 * Workspace record.
 */
export async function getCctpAttestationStatus(params: {
  source: CctpSourceNetwork;
  transactionHash: string;
  apiBaseUrl?: string;
  fetch?: typeof fetch;
}): Promise<CctpAttestationStatus> {
  const source = CCTP_TESTNET_SOURCES[params.source];
  if (!source) throw new Error(`Unsupported CCTP testnet source: ${String(params.source)}`);
  const hash = transactionHash(params.transactionHash, "transactionHash");
  if (!hash) throw new Error("transactionHash is required");
  const apiBaseUrl = (params.apiBaseUrl ?? CCTP_TESTNET_ATTESTATION_API).replace(/\/+$/, "");
  let endpoint: URL;
  try {
    endpoint = new URL(`/v2/messages/${source.domain}`, `${apiBaseUrl}/`);
    endpoint.searchParams.set("transactionHash", hash);
    if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error("apiBaseUrl must be http(s)");
  } catch (error) {
    if (error instanceof Error && error.message === "apiBaseUrl must be http(s)") throw error;
    throw new Error("apiBaseUrl must be a valid URL");
  }
  const fetchImpl = params.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error("fetch is unavailable");
  const response = await fetchImpl(endpoint.toString(), { method: "GET", headers: { accept: "application/json" } });
  const body = await response.json().catch(() => undefined);
  if (!response.ok) throw new Error(`CCTP attestation request failed with HTTP ${response.status}`);
  const message = body && typeof body === "object" && Array.isArray((body as Record<string, unknown>).messages)
    ? (body as { messages: Array<Record<string, unknown>> }).messages[0]
    : undefined;
  return {
    protocol: "circle-cctp-v2",
    sourceDomain: source.domain,
    transactionHash: hash,
    status: attestationState(message?.status),
    ...(typeof message?.message === "string" && message.message ? { message: message.message } : {}),
    ...(typeof message?.attestation === "string" && message.attestation ? { attestation: message.attestation } : {}),
    raw: body,
  };
}

/** Create a Workspace extension without asserting that a burn or mint occurred. */
export function cctpWorkspaceFundingExtension(funding: CctpWorkspaceFunding): { "x-openrails-cctp-funding": CctpWorkspaceFunding } {
  if (funding.protocol !== "circle-cctp-v2") throw new Error("protocol must be circle-cctp-v2");
  if (!funding.sourceNetwork.trim()) throw new Error("sourceNetwork must be non-empty");
  nonNegativeInteger(funding.sourceDomain, "sourceDomain");
  supportedSource(funding.sourceNetwork, funding.sourceDomain);
  if (funding.destinationNetwork !== CCTP_ARC_TESTNET.networkId) {
    throw new Error(`destinationNetwork must be ${CCTP_ARC_TESTNET.networkId}`);
  }
  if (funding.destinationDomain !== CCTP_ARC_TESTNET.domain) {
    throw new Error(`destinationDomain must be ${CCTP_ARC_TESTNET.domain}`);
  }
  const amount = positiveAmount(BigInt(funding.amountBaseUnits), "amountBaseUnits");
  const selectedPaymentMode = paymentMode(funding.paymentMode);
  const status = fundingStatus(funding.status);
  const normalized: CctpWorkspaceFunding = {
    ...funding,
    workspaceRef: normalizeWorkspaceRef(funding.workspaceRef)!,
    paymentMode: selectedPaymentMode,
    status,
    mintRecipient: address(funding.mintRecipient, "mintRecipient"),
    amountBaseUnits: amount.toString(),
    burnTransactionHash: transactionHash(funding.burnTransactionHash, "burnTransactionHash"),
    mintTransactionHash: transactionHash(funding.mintTransactionHash, "mintTransactionHash"),
  };
  if (funding.messageNonce !== undefined && !/^\d+$/.test(funding.messageNonce)) {
    throw new Error("messageNonce must be an unsigned decimal string");
  }
  if (["BURN_CONFIRMED", "ATTESTED", "MINT_CONFIRMED"].includes(funding.status) && !normalized.burnTransactionHash) {
    throw new Error(`${funding.status} funding requires burnTransactionHash`);
  }
  if (["ATTESTED", "MINT_CONFIRMED"].includes(funding.status) && funding.messageNonce === undefined) {
    throw new Error(`${funding.status} funding requires messageNonce`);
  }
  if (funding.status === "MINT_CONFIRMED" && !normalized.mintTransactionHash) {
    throw new Error("MINT_CONFIRMED funding requires mintTransactionHash");
  }
  return { "x-openrails-cctp-funding": normalized };
}
