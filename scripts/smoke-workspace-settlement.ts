import { ethers } from "ethers";
import "dotenv/config";

import {
  ARC_TESTNET_MANIFEST,
  MemoryRuntimeStore,
  Runtime,
  emptyRuntimeState,
  hashRuntimePayload,
  runtimeTransitionMessage,
  RUNTIME_TRANSITION_TYPES,
} from "../packages/openrails-runtime/dist/index.js";
import type { ObjectType, Path, Provenance, RuntimeSignatureBinding } from "../sdk/src/generated/shared-interface";
import {
  approveOpenRailsSpend,
  signPermissionEnvelopeWithSigner,
  submitFlushWithSigner,
  submitOpenPaycardWithSigner,
  submitSettleWithSigner,
  readNonce,
} from "../sdk/src/wallet";
import { hashOpenRailsMetadata } from "../sdk/src/metadata";
import { createArcProvider, safeRpcError } from "../workers/shared/rpc";

const HUB = ARC_TESTNET_MANIFEST.runtime.anchorContract;
const USDC = ARC_TESTNET_MANIFEST.settlementAssets[0];
const NETWORK = { networkId: ARC_TESTNET_MANIFEST.networkId, chainId: ARC_TESTNET_MANIFEST.chainId };
const ALLOCATION = "10000";
const VELOCITY = "1";
const LIFESPAN = "120";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function ref<T extends ObjectType>(type: T, id: string): { type: T; id: string } {
  return { type, id };
}

type LocalSigner = {
  address: string;
  signTypedData: (...args: any[]) => Promise<string>;
};

async function main() {
  const startedAt = new Date();
  const expiresAt = new Date(startedAt.getTime() + 10 * 60_000).toISOString();
  const runId = startedAt.getTime().toString(36);
  const provider = createArcProvider({
    ARC_CANTEEN_RPC_URL: process.env.ARC_CANTEEN_RPC_URL,
    ARC_RPC_URL: process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io",
    ARC_RPC_FALLBACK_URL: process.env.ARC_RPC_FALLBACK_URL,
    ARC_CHAIN_ID: NETWORK.chainId,
  });
  const owner = new ethers.Wallet(required("DEPLOYER_PRIVATE_KEY"), provider);
  const delegate = ethers.Wallet.createRandom();
  const recipient = ethers.getAddress(required("OPENRAILS_RECIPIENT_ADDRESS"));
  const timestamp = startedAt.toISOString();
  const ids = {
    workspace: `workspace:arc-proof:${runId}`,
    owner: `actor:owner:${runId}`,
    delegate: `actor:delegate:${runId}`,
    path: `path:arc-proof:${runId}`,
    intent: `intent:arc-proof:${runId}`,
    proposal: `proposal:arc-proof:${runId}`,
    decision: `decision:arc-proof:${runId}`,
    pact: `pact:arc-proof:${runId}`,
  };
  const provenance = (source: Provenance["source"] = "runtime-evaluation", authority = "OpenRails Phase 5 proof"): Provenance => ({
    source,
    authority,
    evidenceLevel: source === "operator-record" ? "independently-verified" : "runtime-observed",
    observedAt: timestamp,
    evidenceRefs: [`EVD-OR-R5-${runId}`],
  });
  const paymentTerms = {
    asset: USDC,
    amount: ALLOCATION,
    settlementShape: "streamed",
    recipient,
    velocityPerSecond: VELOCITY,
    lifespanSeconds: LIFESPAN,
    allowanceAmount: ALLOCATION,
  };
  const genericBinding = (signer: string, signature = "0x") => ({
    signer,
    signature,
    nonce: "0",
    issuedAt: timestamp,
    expiresAt,
    chainId: NETWORK.chainId,
    verifyingContract: HUB,
    domain: { name: "OpenRails Network", version: "2.0.0", chainId: NETWORK.chainId, verifyingContract: HUB },
  });

  const workspace = {
    interfaceVersion: "1.2.0" as const,
    id: ids.workspace,
    name: "Arc Delegated Settlement Proof",
    ownerActorRef: ref("Actor", ids.owner),
    status: "DRAFT",
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: provenance("wallet-signed"),
  };
  const ownerActor = {
    interfaceVersion: "1.2.0",
    id: ids.owner,
    kind: "person",
    displayName: "Workspace Owner",
    authorityStatus: "VERIFIED",
    walletAddress: owner.address,
    createdAt: timestamp,
    provenance: provenance("wallet-signed"),
  };
  const delegateActor = {
    interfaceVersion: "1.2.0",
    id: ids.delegate,
    kind: "agent",
    displayName: "Bounded Settlement Delegate",
    authorityStatus: "VERIFIED",
    walletAddress: delegate.address,
    createdAt: timestamp,
    provenance: provenance("wallet-signed"),
  };
  const unsignedPath = {
    interfaceVersion: "1.2.0" as const,
    id: ids.path,
    executionProfile: "delegated-runtime" as const,
    workspaceRef: ref("Workspace", ids.workspace),
    issuerActorRef: ref("Actor", ids.owner),
    delegateActorRef: ref("Actor", ids.delegate),
    capabilities: ["CREATE_RAILSFLOW"],
    limits: [{
      asset: USDC,
      maxAmount: ALLOCATION,
      maxAmountPerTransaction: ALLOCATION,
      maxVelocityPerSecond: VELOCITY,
      maxLifespanSeconds: LIFESPAN,
      maxTransactionsPerPeriod: "1",
      periodSeconds: "3600",
    }],
    status: "ACTIVE" as const,
    signatureBinding: genericBinding(owner.address),
    provenance: provenance("wallet-signed"),
  };
  const pathDigest = hashRuntimePayload({ purpose: "openrails-application-path-attestation-v1", path: unsignedPath });
  const path: Path = {
    ...unsignedPath,
    signatureBinding: genericBinding(owner.address, await owner.signMessage(ethers.getBytes(pathDigest))),
  };
  const intent = {
    interfaceVersion: "1.2.0",
    id: ids.intent,
    executionProfile: "delegated-runtime",
    subject: { actorRef: ref("Actor", ids.delegate), role: "delegate" },
    action: "CREATE_RAILSFLOW",
    paymentTerms,
    requestedNetwork: NETWORK,
    workspaceRef: ref("Workspace", ids.workspace),
    pathRef: ref("Path", ids.path),
    nonce: "0",
    expiresAt,
    status: "DRAFT",
    createdAt: timestamp,
    provenance: provenance("wallet-signed"),
  };
  const proposal = {
    interfaceVersion: "1.2.0",
    id: ids.proposal,
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", ids.workspace),
    pathRef: ref("Path", ids.path),
    intentRef: ref("Intent", ids.intent),
    normalizedTerms: paymentTerms,
    inputHash: hashRuntimePayload({ intent, paymentTerms }),
    policyVersion: "policy:arc-proof:1",
    status: "EVALUATING",
    createdAt: timestamp,
    provenance: provenance(),
  };
  const decision = {
    interfaceVersion: "1.2.0",
    id: ids.decision,
    executionProfile: "delegated-runtime",
    proposalRef: ref("Proposal", ids.proposal),
    decision: "ALLOW",
    policyVersion: proposal.policyVersion,
    inputHash: proposal.inputHash,
    reasonCodes: ["WITHIN_LIMITS"],
    pactRef: ref("Pact", ids.pact),
    effects: { financialEffect: "NONE", walletAction: "NONE", paycardCreated: false, valueMoved: false },
    decidedAt: timestamp,
    provenance: provenance(),
  };
  const pact = {
    interfaceVersion: "1.2.0",
    id: ids.pact,
    executionProfile: "delegated-runtime",
    workspaceRef: ref("Workspace", ids.workspace),
    pathRef: ref("Path", ids.path),
    proposalRef: ref("Proposal", ids.proposal),
    decisionRef: ref("BaphometDecision", ids.decision),
    parties: [ref("Actor", ids.owner), ref("Actor", ids.delegate)],
    paymentTerms,
    proofPolicy: {
      interfaceVersion: "1.2.0",
      id: `proof-policy:arc-proof:${runId}`,
      executionProfile: "delegated-runtime",
      requiredGate: "NONE",
      beforeTransition: "NONE",
      placement: "immediately-before",
      required: false,
      policyVersion: proposal.policyVersion,
      termsHash: hashRuntimePayload(paymentTerms),
    },
    status: "DRAFT",
    createdAt: timestamp,
    signatureBinding: genericBinding(owner.address),
    provenance: provenance("wallet-signed"),
  };

  const store = new MemoryRuntimeStore(emptyRuntimeState());
  const runtime = new Runtime({
    store,
    provider,
    now: () => new Date(),
    pathAttestor: {
      async attest(candidate: Path) {
        const unsigned = { ...candidate, signatureBinding: { ...candidate.signatureBinding, signature: "0x" } };
        const digest = hashRuntimePayload({ purpose: "openrails-application-path-attestation-v1", path: unsigned });
        const recovered = ethers.verifyMessage(ethers.getBytes(digest), candidate.signatureBinding.signature);
        if (ethers.getAddress(recovered) !== owner.address) throw new Error("Path application signature is invalid");
        return provenance("operator-record", "OpenRails application Path verifier");
      },
    },
  });
  const signedData = async (operationId: string, unsignedData: unknown, signer: LocalSigner, nonce: number) => {
    const binding: RuntimeSignatureBinding = {
      signatureStandard: "eip-712" as const,
      primaryType: "OpenRailsRuntimeTransition" as const,
      signaturePurpose: "offchain-runtime" as const,
      operationId,
      payloadHash: hashRuntimePayload(unsignedData),
      signer: signer.address,
      signature: "0x",
      nonce: String(nonce),
      issuedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
      chainId: NETWORK.chainId,
      anchorContract: HUB,
      domain: ARC_TESTNET_MANIFEST.runtime.signatureDomain,
    };
    binding.signature = await signer.signTypedData(binding.domain, RUNTIME_TRANSITION_TYPES, runtimeTransitionMessage(binding));
    return { ...(unsignedData as Record<string, unknown>), signatureBinding: binding };
  };
  const request = (operationId: string, data: unknown, signer: LocalSigner, refs: Record<string, unknown> = {}) => ({
    interfaceVersion: "1.2.0",
    executionProfile: "delegated-runtime",
    operationId,
    capability: operationId,
    authorizationClass: "RELAY_SIGNED_ENVELOPE",
    subject: { walletAddress: signer.address, role: signer.address === delegate.address ? "delegate" : "owner" },
    network: NETWORK,
    ...refs,
    data,
    provenance: provenance("wallet-signed"),
    createdAt: new Date().toISOString(),
  });

  const workspaceResponse = await runtime.execute(request("workspace.register", await signedData("workspace.register", { workspace }, owner, 0), owner));
  await runtime.execute(request("actor.register", await signedData("actor.register", { workspaceRef: ref("Workspace", ids.workspace), actor: ownerActor }, owner, 1), owner, { workspaceRef: ref("Workspace", ids.workspace) }));
  await runtime.execute(request("actor.register", await signedData("actor.register", { workspaceRef: ref("Workspace", ids.workspace), actor: delegateActor }, owner, 2), owner, { workspaceRef: ref("Workspace", ids.workspace) }));
  await runtime.ingestPath(path);
  await store.transact((tx) => { tx.state.intents[ids.intent] = structuredClone(intent) as never; });
  const proposalData = await signedData("proposal.submit", { proposal }, delegate, 0);
  const proposalResponse = await runtime.execute(request("proposal.submit", proposalData, delegate, {
    workspaceRef: ref("Workspace", ids.workspace), pathRef: ref("Path", ids.path), intentRef: ref("Intent", ids.intent), proposalRef: ref("Proposal", ids.proposal),
  }));
  await store.transact((tx) => {
    tx.state.proposals[ids.proposal] = { ...structuredClone(proposal), status: "ALLOWED" } as never;
    tx.state.decisions[ids.decision] = structuredClone(decision) as never;
  });
  const pactData = await signedData("pact.sign", { intentRef: ref("Intent", ids.intent), pact }, delegate, 1);
  const pactResponse = await runtime.execute(request("pact.sign", pactData, delegate, {
    workspaceRef: ref("Workspace", ids.workspace), pathRef: ref("Path", ids.path), intentRef: ref("Intent", ids.intent), proposalRef: ref("Proposal", ids.proposal), decisionRef: ref("BaphometDecision", ids.decision), pactRef: ref("Pact", ids.pact),
  }));

  const nonceChannel = 700_000 + Math.floor(Math.random() * 100_000);
  const sdkProvider = provider as unknown as Parameters<typeof readNonce>[0];
  const nonceValue = await readNonce(sdkProvider, HUB, owner.address, nonceChannel);
  const latest = await provider.getBlock("latest");
  if (!latest) throw new Error("Latest Arc block is unavailable");
  const metadata = {
    version: "openrails-metadata-v1" as const,
    mode: "railsflow" as const,
    originator: owner.address,
    recipient,
    token: USDC.address,
    amount: ALLOCATION,
    flowVelocityPerSecond: VELOCITY,
    lifespanSeconds: Number(LIFESPAN),
    metadataRef: `workspace=${ids.workspace};pact=${ids.pact}`,
  };
  const settlementIntent = {
    paycardId: ethers.keccak256(ethers.toUtf8Bytes(`workspace-settlement:${ids.pact}`)),
    metadataHash: hashOpenRailsMetadata(metadata),
    recipient,
    totalAllocationPool: ALLOCATION,
    flowVelocityPerSecond: VELOCITY,
    genesisTimestamp: latest.timestamp - 5,
    lifespanSeconds: Number(LIFESPAN),
    residualDeltaRecipient: owner.address,
    nonceChannel,
    nonceValue,
  };
  const sdkSigner = owner as unknown as Parameters<typeof approveOpenRailsSpend>[0];
  await (await approveOpenRailsSpend(sdkSigner, USDC.address, HUB, BigInt(ALLOCATION))).wait();
  const token = await signPermissionEnvelopeWithSigner(sdkSigner, { chainId: Number(NETWORK.chainId), clearinghouseAddress: HUB, usdcAddress: USDC.address }, settlementIntent, { mode: "railsflow", metadata });
  const open = await submitOpenPaycardWithSigner(sdkSigner, HUB, token, "railsflow");
  const openReceipt = await open.wait();
  const settle = await submitSettleWithSigner(sdkSigner, HUB, settlementIntent.paycardId);
  const settleReceipt = await settle.wait();
  const flush = await submitFlushWithSigner(sdkSigner, HUB, settlementIntent.paycardId);
  const flushReceipt = await flush.wait();
  const contract = new ethers.Contract(HUB, [
    "function registry(bytes32) view returns (address payer,address recipient,bytes32 metadataHash,uint256 totalAllocationPool,uint256 availableBalance,uint256 flowVelocityPerSecond,uint256 genesisTimestamp,uint256 lifespanSeconds,uint256 lastCheckpointEpoch,address residualDeltaRecipient,uint8 operationalStatus)",
  ], provider);
  const row = await contract.registry(settlementIntent.paycardId);
  if (openReceipt?.status !== 1 || settleReceipt?.status !== 1 || flushReceipt?.status !== 1) throw new Error("A settlement transaction was not successful");
  if (row.availableBalance !== 0n || row.operationalStatus !== 1n || row.metadataHash !== settlementIntent.metadataHash) throw new Error("Final Vault reconciliation failed");

  console.log(JSON.stringify({
    ok: true,
    network: NETWORK,
    runtime: {
      workspaceId: ids.workspace,
      pathId: ids.path,
      intentId: ids.intent,
      proposalId: ids.proposal,
      pactId: ids.pact,
      delegate: delegate.address,
      workspaceState: workspaceResponse.lifecycleState,
      proposalState: proposalResponse.lifecycleState,
      pactState: pactResponse.lifecycleState,
    },
    settlement: {
      paycardId: settlementIntent.paycardId,
      metadataRef: metadata.metadataRef,
      metadataHash: settlementIntent.metadataHash,
      openTx: open.hash,
      settleTx: settle.hash,
      flushTx: flush.hash,
      finalAvailableBalance: row.availableBalance.toString(),
      finalOperationalStatus: row.operationalStatus.toString(),
    },
  }, null, 2));
  provider.destroy?.();
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: safeRpcError(error, "Workspace settlement proof failed") }, null, 2));
  process.exitCode = 1;
});
