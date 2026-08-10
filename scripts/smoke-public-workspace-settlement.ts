import { ethers } from "ethers";
import "dotenv/config";

import {
  ARC_TESTNET_MANIFEST,
  RuntimeClient,
  hashRuntimePayload,
} from "../sdk/src/index";
import {
  approveOpenRailsSpend,
  readNonce,
  signPermissionEnvelopeWithSigner,
  submitFlushWithSigner,
  submitOpenPaycardWithSigner,
  submitSettleWithSigner,
} from "../sdk/src/wallet";
import { hashOpenRailsMetadata } from "../sdk/src/metadata";
import { createArcProvider, safeRpcError } from "../workers/shared/rpc";

const HUB = ARC_TESTNET_MANIFEST.runtime.anchorContract;
const USDC = ARC_TESTNET_MANIFEST.settlementAssets[0];
const NETWORK = { networkId: ARC_TESTNET_MANIFEST.networkId, chainId: ARC_TESTNET_MANIFEST.chainId };
const RUNTIME_BASE = process.env.OPENRAILS_RUNTIME_BASE?.trim()
  || "https://openrails-interface-worker.microcosm.workers.dev";
const ALLOCATION = "10000";
const VELOCITY = "1";
const LIFESPAN = "120";

async function resilientFetch(input: string, init?: RequestInit): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await fetch(input, {
        ...init,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Runtime Worker request failed.");
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function ref(type: string, id: string) {
  return { type, id };
}

function responseData(value: unknown): Record<string, any> {
  if (!value || typeof value !== "object") throw new Error("Runtime response is not an object");
  const data = (value as Record<string, any>).data;
  if (!data || typeof data !== "object") throw new Error("Runtime response data is missing");
  return data as Record<string, any>;
}

function provenance(source: "wallet-signed" | "runtime-evaluation" = "wallet-signed", observedAt: string): Record<string, string> {
  return {
    source,
    authority: "OpenRails public Runtime smoke",
    evidenceLevel: "runtime-observed",
    observedAt,
  };
}

function pathBinding(signer: string, issuedAt: string, expiresAt: string, signature = "0x") {
  return {
    signer,
    signature,
    nonce: "0",
    issuedAt,
    expiresAt,
    chainId: NETWORK.chainId,
    verifyingContract: HUB,
    domain: {
      name: "OpenRails Network",
      version: "2.0.0",
      chainId: NETWORK.chainId,
      verifyingContract: HUB,
    },
  };
}

async function main() {
  const startedAt = new Date();
  const timestamp = startedAt.toISOString();
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
  const runtime = new RuntimeClient({ baseUrl: RUNTIME_BASE, fetch: resilientFetch });
  const ids = {
    workspace: `workspace:public-proof:${runId}`,
    owner: `actor:owner:${runId}`,
    delegate: `actor:delegate:${runId}`,
    path: `path:public-proof:${runId}`,
    intent: `intent:public-proof:${runId}`,
    proposal: `proposal:public-proof:${runId}`,
    pact: `pact:public-proof:${runId}`,
    proof: `proof:public-proof:${runId}`,
    blockedIntent: `intent:public-blocked:${runId}`,
    blockedProposal: `proposal:public-blocked:${runId}`,
    blockedPact: `pact:public-blocked:${runId}`,
  };
  const paymentTerms = {
    asset: USDC,
    amount: ALLOCATION,
    settlementShape: "streamed",
    recipient,
    velocityPerSecond: VELOCITY,
    lifespanSeconds: LIFESPAN,
    allowanceAmount: ALLOCATION,
  };
  const ownerActorRef = ref("Actor", ids.owner);
  const delegateActorRef = ref("Actor", ids.delegate);
  const workspaceRef = ref("Workspace", ids.workspace);
  const pathRef = ref("Path", ids.path);
  const ownerActor = {
    interfaceVersion: "1.2.0",
    id: ids.owner,
    kind: "person",
    displayName: "Workspace Owner",
    authorityStatus: "VERIFIED",
    walletAddress: owner.address,
    createdAt: timestamp,
    provenance: provenance("wallet-signed", timestamp),
  };
  const delegateActor = {
    interfaceVersion: "1.2.0",
    id: ids.delegate,
    kind: "agent",
    displayName: "Bounded Settlement Delegate",
    authorityStatus: "VERIFIED",
    walletAddress: delegate.address,
    createdAt: timestamp,
    provenance: provenance("wallet-signed", timestamp),
  };
  const workspace = {
    interfaceVersion: "1.2.0",
    id: ids.workspace,
    name: "Public Arc delegated settlement proof",
    ownerActorRef,
    status: "DRAFT",
    createdAt: timestamp,
    updatedAt: timestamp,
    provenance: provenance("wallet-signed", timestamp),
  };
  const unsignedPath = {
    interfaceVersion: "1.2.0",
    id: ids.path,
    executionProfile: "delegated-runtime",
    workspaceRef,
    issuerActorRef: ownerActorRef,
    delegateActorRef,
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
    status: "PREPARED",
    signatureBinding: pathBinding(owner.address, timestamp, expiresAt),
    provenance: provenance("wallet-signed", timestamp),
  };
  const pathDigest = hashRuntimePayload({
    purpose: "openrails-application-path-attestation-v1",
    path: unsignedPath,
  });
  const path = {
    ...unsignedPath,
    signatureBinding: {
      ...unsignedPath.signatureBinding,
      signature: await owner.signMessage(ethers.getBytes(pathDigest)),
    },
  };

  const workspaceResponse = await runtime.execute("workspace.register", { workspace }, owner, { role: "owner" });
  await runtime.execute("actor.register", { workspaceRef, actor: ownerActor }, owner, { role: "owner", workspaceRef });
  await runtime.execute("actor.register", { workspaceRef, actor: delegateActor }, owner, { role: "owner", workspaceRef });
  const ingested = (await runtime.ingestPath(path) as any).path;
  const activatedPath = responseData(await runtime.execute("path.activate", { path: ingested }, owner, {
    role: "owner",
    workspaceRef,
    pathRef,
  })).path;

  const pactRef = ref("Pact", ids.pact);
  const intent = {
    interfaceVersion: "1.2.0",
    id: ids.intent,
    executionProfile: "delegated-runtime",
    subject: { actorRef: delegateActorRef, role: "delegate" },
    action: "CREATE_RAILSFLOW",
    paymentTerms,
    requestedNetwork: NETWORK,
    workspaceRef,
    pathRef,
    pactRef,
    nonce: "0",
    expiresAt,
    status: "DRAFT",
    createdAt: timestamp,
    provenance: provenance("wallet-signed", timestamp),
  };
  const intentResponse = await runtime.execute("intent.prepare", { intent }, owner, {
    role: "owner",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.intent),
  });
  const preparedIntent = responseData(intentResponse).intent;
  const proposal = {
    interfaceVersion: "1.2.0",
    id: ids.proposal,
    executionProfile: "delegated-runtime",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.intent),
    normalizedTerms: paymentTerms,
    inputHash: hashRuntimePayload({ intent: preparedIntent, paymentTerms }),
    policyVersion: "baphomet-runtime-1.2.0",
    status: "EVALUATING",
    createdAt: timestamp,
    provenance: provenance("runtime-evaluation", timestamp),
  };
  const proposalResponse = await runtime.execute("proposal.evaluate", { proposal }, delegate, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.intent),
    proposalRef: ref("Proposal", ids.proposal),
  });
  const decision = responseData(proposalResponse).decision;
  if (decision.decision !== "ALLOW") throw new Error("The bounded public proposal was unexpectedly blocked.");
  const pact = {
    interfaceVersion: "1.2.0",
    id: ids.pact,
    executionProfile: "delegated-runtime",
    workspaceRef,
    pathRef,
    proposalRef: ref("Proposal", ids.proposal),
    decisionRef: ref("BaphometDecision", decision.id),
    parties: [ownerActorRef, delegateActorRef],
    paymentTerms,
    proofPolicy: {
      interfaceVersion: "1.2.0",
      id: `proof-policy:public-proof:${runId}`,
      executionProfile: "delegated-runtime",
      requiredGate: "FINAL_SETTLEMENT",
      beforeTransition: "SETTLEMENT",
      placement: "immediately-before",
      required: true,
      policyVersion: proposal.policyVersion,
      termsHash: hashRuntimePayload(paymentTerms),
    },
    status: "DRAFT",
    createdAt: timestamp,
    signatureBinding: pathBinding(delegate.address, timestamp, expiresAt),
    provenance: provenance("wallet-signed", timestamp),
  };
  const pactResponse = await runtime.execute("pact.sign", {
    intentRef: ref("Intent", ids.intent),
    pact,
  }, delegate, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.intent),
    proposalRef: pact.proposalRef,
    decisionRef: pact.decisionRef,
    pactRef,
  });
  const proof = {
    interfaceVersion: "1.2.0",
    id: ids.proof,
    executionProfile: "delegated-runtime",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.intent),
    proposalRef: ref("Proposal", ids.proposal),
    pactRef,
    policyRef: ref("ProofPolicy", pact.proofPolicy.id),
    subjectRef: delegateActorRef,
    gate: "FINAL_SETTLEMENT",
    beforeTransition: "SETTLEMENT",
    placement: "immediately-before",
    evidenceHash: hashRuntimePayload({ workspaceRef, pactRef, event: "bounded-work-complete" }),
    status: "SUBMITTED",
    submittedAt: new Date().toISOString(),
    provenance: provenance("wallet-signed", timestamp),
  };
  await runtime.execute("proof.submit", { proof }, delegate, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef: proof.intentRef,
    proposalRef: proof.proposalRef,
    pactRef,
    proofRefs: [ref("Proof", ids.proof)],
  });
  const proofResponse = await runtime.execute("proof.verify", { objectRef: ref("Proof", ids.proof) }, owner, {
    role: "owner",
    workspaceRef,
    pathRef,
    intentRef: proof.intentRef,
    proposalRef: proof.proposalRef,
    pactRef,
    proofRefs: [ref("Proof", ids.proof)],
  });

  const blockedTerms = { ...paymentTerms, amount: String(Number(ALLOCATION) + 1), allowanceAmount: String(Number(ALLOCATION) + 1) };
  const blockedPactRef = ref("Pact", ids.blockedPact);
  const blockedIntent = {
    ...intent,
    id: ids.blockedIntent,
    pactRef: blockedPactRef,
    paymentTerms: blockedTerms,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
  const blockedIntentResponse = await runtime.execute("intent.prepare", { intent: blockedIntent }, owner, {
    role: "owner",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.blockedIntent),
  });
  const blockedProposal = {
    ...proposal,
    id: ids.blockedProposal,
    intentRef: ref("Intent", ids.blockedIntent),
    normalizedTerms: blockedTerms,
    inputHash: hashRuntimePayload({ intent: responseData(blockedIntentResponse).intent, paymentTerms: blockedTerms }),
    createdAt: new Date().toISOString(),
  };
  const blockedResponse = await runtime.execute("proposal.evaluate", { proposal: blockedProposal }, delegate, {
    role: "delegate",
    workspaceRef,
    pathRef,
    intentRef: ref("Intent", ids.blockedIntent),
    proposalRef: ref("Proposal", ids.blockedProposal),
  });
  const blockedDecision = responseData(blockedResponse).decision;
  if (blockedDecision.decision !== "BLOCK") throw new Error("The over-limit public proposal was unexpectedly allowed.");

  const nonceChannel = 800_000 + Math.floor(Math.random() * 100_000);
  const sdkProvider = provider as any;
  const sdkOwner = owner as any;
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
    metadataRef: `workspace=${ids.workspace};path=${ids.path};pact=${ids.pact};proof=${ids.proof}`,
  };
  const settlementIntent = {
    paycardId: ethers.keccak256(ethers.toUtf8Bytes(`public-workspace-settlement:${ids.pact}`)),
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
  await (await approveOpenRailsSpend(sdkOwner, USDC.address, HUB, BigInt(ALLOCATION))).wait();
  const token = await signPermissionEnvelopeWithSigner(sdkOwner, {
    chainId: Number(NETWORK.chainId),
    clearinghouseAddress: HUB,
    usdcAddress: USDC.address,
  }, settlementIntent, { mode: "railsflow", metadata });
  const open = await submitOpenPaycardWithSigner(sdkOwner, HUB, token, "railsflow");
  const openReceipt = await open.wait();
  const settle = await submitSettleWithSigner(sdkOwner, HUB, settlementIntent.paycardId);
  const settleReceipt = await settle.wait();
  const flush = await submitFlushWithSigner(sdkOwner, HUB, settlementIntent.paycardId);
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
    runtimeBase: RUNTIME_BASE,
    runtime: {
      workspaceId: ids.workspace,
      pathId: ids.path,
      intentId: ids.intent,
      proposalId: ids.proposal,
      pactId: ids.pact,
      proofId: ids.proof,
      delegate: delegate.address,
      workspaceState: (workspaceResponse as any).lifecycleState,
      intentState: (intentResponse as any).lifecycleState,
      proposalState: (proposalResponse as any).lifecycleState,
      pactState: (pactResponse as any).lifecycleState,
      proofState: (proofResponse as any).lifecycleState,
      blockedProposalState: (blockedResponse as any).lifecycleState,
      blockedReason: blockedDecision.reasonCodes,
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
  const cause = error && typeof error === "object" && "cause" in error
    ? (error as { cause?: { code?: string; message?: string } }).cause
    : undefined;
  const body = error && typeof error === "object" && "body" in error
    ? (error as { body?: Record<string, any> }).body
    : undefined;
  const runtimeError = body?.errors?.[0];
  console.error(JSON.stringify({
    ok: false,
    error: safeRpcError(error, "Public Workspace settlement proof failed"),
    ...(cause?.code || cause?.message ? { cause: { code: cause.code, message: cause.message } } : {}),
    ...(body?.code || body?.error ? { response: { code: body.code, error: body.error, detail: runtimeError?.details, lifecycleState: runtimeError?.lifecycleState } } : {}),
  }, null, 2));
  process.exitCode = 1;
});
