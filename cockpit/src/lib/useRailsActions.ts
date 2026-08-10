/**
 * useRailsActions — the self-submit pay/claim flow behind an OpenRails link,
 * factored out of the Creator (claim) and OpenStreamModal (pay) UIs so a public
 * link-landing page can act on a received link with one call.
 *
 * Both paths are non-custodial: the connected wallet submits directly to the Hub
 * (no relayer). For a RailsCard the payer already signed, so the claimer only
 * pays gas; for a RailsFlow the connected wallet IS the payer (escrow comes from
 * them). Mirrors OpenStreamModal.handleOpen / Creator.ClaimCard.claim.
 */
import { useState } from "react";
import { useAccount, useSignTypedData, useWriteContract, usePublicClient, useSwitchChain } from "wagmi";
import { api, useConfig } from "./api";
import { USDC_ABI, HUB_ABI } from "./contracts";
import { arcTestnet } from "./chain";
import {
  type CanonicalMetadataV1,
  type CryptographicEnvelopeV1,
  OPENRAILS_EIP712_TYPES,
  buildOpenRailsDomain,
  hashOpenRailsMetadata,
  buildMetadataBoundPaycardId,
  deserializeEnvelope,
  serializeEnvelope,
} from "./intents";
import { signFlowPermit } from "./permit";
import type { OpenRailsLinkArtifact, RailsCardLinkPayload, RailsFlowLinkPayload } from "./links";
import { evaluateRailsCardFunding } from "./railsCardFunding";

// Public gasless claim relay (the funded keeper worker). Override per-deploy if needed.
const RELAY_URL =
  (import.meta.env.VITE_OPENRAILS_RELAY_URL as string | undefined) ??
  "https://openrails-reconciliation-worker.microcosm.workers.dev";

export type RailsActionStatus =
  | { id: "idle" }
  | { id: "approving" }
  | { id: "signing" }
  | { id: "submitting" }
  | { id: "success"; txHash: string; paycardId: string }
  | { id: "error"; msg: string };

function actionErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  if (
    normalized.includes("http request failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("429") ||
    normalized.includes("timeout") ||
    normalized.includes("network error")
  ) {
    return "Arc RPC is temporarily unavailable. Retry the network check in a moment.";
  }
  if (normalized.includes("permit is expired") || normalized.includes("permit expired")) {
    return "The sender's authorization expired. Ask the sender to reissue this payment.";
  }
  return message.slice(0, 220);
}

export function useRailsActions() {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const { config, conn } = useConfig();
  const [status, setStatus] = useState<RailsActionStatus>({ id: "idle" });

  const busy =
    status.id === "approving" || status.id === "signing" || status.id === "submitting";

  function reset() {
    setStatus({ id: "idle" });
  }

  /** Claim a RailsCard: the payer already signed; the claimer self-submits (gas only). */
  async function claimRailsCard(artifact: OpenRailsLinkArtifact): Promise<void> {
    if (!config) return setStatus({ id: "error", msg: "Config not loaded." });
    if (!address) return setStatus({ id: "error", msg: "Connect a wallet first." });
    
    // Enforce switching to Arc Testnet
    if (chainId !== arcTestnet.id) {
      try {
        await switchChainAsync({ chainId: arcTestnet.id });
      } catch (err) {
        return setStatus({ id: "error", msg: "Please switch your wallet network to Arc Testnet." });
      }
    }

    const pl = artifact.payload as RailsCardLinkPayload;
    try {
      const envelope = deserializeEnvelope<CryptographicEnvelopeV1>(pl.envelopeToken);
      const i = envelope.intent;
      const hub = config.clearinghouseAddress as `0x${string}`;
      const usdc = config.usdcAddress as `0x${string}`;

      const [payerBalance, payerAllowance, currentNonce] = (await Promise.all([
        publicClient!.readContract({ address: usdc, abi: USDC_ABI, functionName: "balanceOf", args: [envelope.payerAddress as `0x${string}`] }),
        publicClient!.readContract({ address: usdc, abi: USDC_ABI, functionName: "allowance", args: [envelope.payerAddress as `0x${string}`, hub] }),
        publicClient!.readContract({ address: hub, abi: HUB_ABI, functionName: "accountNonceTracks", args: [envelope.payerAddress as `0x${string}`, BigInt(i.nonceChannel)] }),
      ])) as [bigint, bigint, bigint];
      let funding = evaluateRailsCardFunding({
        expectedNonce: BigInt(i.nonceValue),
        currentNonce,
        balance: payerBalance,
        allowance: payerAllowance,
        allocation: BigInt(i.totalAllocationPool),
        permit: envelope.permit,
        payer: envelope.payerAddress,
        hub,
      });
      if (!funding.ok) throw new Error(funding.message);

      // Legacy RailsCards may carry a permit. New cards establish allowance at issuance.
      if (funding.needsPermit && envelope.permit) {
        setStatus({ id: "approving" });
        const p = envelope.permit;
        try {
          const permitTx = await writeContractAsync({
            address: usdc,
            abi: [
              {
                name: "permit",
                type: "function",
                stateMutability: "nonpayable",
                inputs: [
                  { name: "owner", type: "address" },
                  { name: "spender", type: "address" },
                  { name: "value", type: "uint256" },
                  { name: "deadline", type: "uint256" },
                  { name: "v", type: "uint8" },
                  { name: "r", type: "bytes32" },
                  { name: "s", type: "bytes32" },
                ],
                outputs: [],
              },
            ] as const,
            functionName: "permit",
            args: [
              p.owner as `0x${string}`,
              p.spender as `0x${string}`,
              BigInt(p.value),
              BigInt(p.deadline),
              p.v,
              p.r as `0x${string}`,
              p.s as `0x${string}`,
            ],
          });
          await publicClient!.waitForTransactionReceipt({ hash: permitTx, timeout: 120_000 });
        } catch (permitErr) {
          const allowance = (await publicClient!.readContract({
            address: usdc,
            abi: USDC_ABI,
            functionName: "allowance",
            args: [envelope.payerAddress as `0x${string}`, hub],
          })) as bigint;
          funding = evaluateRailsCardFunding({
            expectedNonce: BigInt(i.nonceValue),
            currentNonce,
            balance: payerBalance,
            allowance,
            allocation: BigInt(i.totalAllocationPool),
            payer: envelope.payerAddress,
            hub,
          });
          if (!funding.ok) {
            console.warn("Legacy RailsCard permit failed", permitErr);
            throw new Error(funding.message);
          }
        }
      }

      const recipientArg =
        pl.mode === "railscard_bearer" ? (address as `0x${string}`) : (i.recipient as `0x${string}`);
      const args = [
        i.paycardId as `0x${string}`,
        i.metadataHash as `0x${string}`,
        recipientArg,
        BigInt(i.totalAllocationPool),
        BigInt(i.flowVelocityPerSecond),
        BigInt(i.genesisTimestamp),
        BigInt(i.lifespanSeconds),
        i.residualDeltaRecipient as `0x${string}`,
        envelope.envelopeSignature as `0x${string}`,
        BigInt(i.nonceChannel),
        BigInt(i.nonceValue),
        envelope.payerAddress as `0x${string}`, // V2: explicit payer (EOA + EIP-1271)
      ] as const;

      setStatus({ id: "submitting" });
      const txHash =
        pl.mode === "railscard_bearer"
          ? await writeContractAsync({ address: hub, abi: HUB_ABI, functionName: "claimWildcardPaycardChannel", args })
          : await writeContractAsync({ address: hub, abi: HUB_ABI, functionName: "openPaycardChannel", args });
      await publicClient!.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
      setStatus({ id: "success", txHash, paycardId: i.paycardId });
    } catch (e) {
      setStatus({ id: "error", msg: actionErrorMessage(e) });
    }
  }

  /**
   * Claim a RailsCard gaslessly: the funded keeper submits the claim on the claimer's behalf.
   * The claimer pays no gas; escrow still flows payer → claimer per the signed intent. For a
   * bearer card the connected wallet is the destination; for a recipient-bound card the relay
   * ignores it and honors the signed recipient.
   */
  async function claimRailsCardSponsored(artifact: OpenRailsLinkArtifact): Promise<void> {
    if (!config) return setStatus({ id: "error", msg: "Config not loaded." });
    if (!address) return setStatus({ id: "error", msg: "Connect a wallet first." });
    
    // Enforce switching to Arc Testnet
    if (chainId !== arcTestnet.id) {
      try {
        await switchChainAsync({ chainId: arcTestnet.id });
      } catch (err) {
        return setStatus({ id: "error", msg: "Please switch your wallet network to Arc Testnet." });
      }
    }

    const pl = artifact.payload as RailsCardLinkPayload;
    try {
      const envelope = deserializeEnvelope<CryptographicEnvelopeV1>(pl.envelopeToken);
      const i = envelope.intent;
      const hub = config.clearinghouseAddress as `0x${string}`;
      const usdc = config.usdcAddress as `0x${string}`;
      const [payerBalance, payerAllowance, currentNonce] = (await Promise.all([
        publicClient!.readContract({ address: usdc, abi: USDC_ABI, functionName: "balanceOf", args: [envelope.payerAddress as `0x${string}`] }),
        publicClient!.readContract({ address: usdc, abi: USDC_ABI, functionName: "allowance", args: [envelope.payerAddress as `0x${string}`, hub] }),
        publicClient!.readContract({ address: hub, abi: HUB_ABI, functionName: "accountNonceTracks", args: [envelope.payerAddress as `0x${string}`, BigInt(i.nonceChannel)] }),
      ])) as [bigint, bigint, bigint];
      const funding = evaluateRailsCardFunding({
        expectedNonce: BigInt(i.nonceValue),
        currentNonce,
        balance: payerBalance,
        allowance: payerAllowance,
        allocation: BigInt(i.totalAllocationPool),
        permit: envelope.permit,
        payer: envelope.payerAddress,
        hub,
      });
      if (!funding.ok) throw new Error(funding.message);

      setStatus({ id: "submitting" });
      const res = await fetch(`${RELAY_URL}/relay-claim`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelopeToken: pl.envelopeToken, claimRecipient: address }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus({ id: "success", txHash: data.txHash, paycardId: data.paycardId });
    } catch (e) {
      setStatus({ id: "error", msg: actionErrorMessage(e) });
    }
  }

  /** Pay a RailsFlow request: the connected wallet becomes the payer and opens the stream. */
  async function payRailsFlow(artifact: OpenRailsLinkArtifact): Promise<void> {
    if (!config) return setStatus({ id: "error", msg: "Config not loaded." });
    if (!address) return setStatus({ id: "error", msg: "Connect a wallet first." });
    
    // Enforce switching to Arc Testnet
    if (chainId !== arcTestnet.id) {
      try {
        await switchChainAsync({ chainId: arcTestnet.id });
      } catch (err) {
        return setStatus({ id: "error", msg: "Please switch your wallet network to Arc Testnet." });
      }
    }

    const pl = artifact.payload as RailsFlowLinkPayload;
    if (pl.expiresAt && Date.now() / 1000 > pl.expiresAt) {
      return setStatus({ id: "error", msg: "This request link has expired." });
    }
    try {
      const hub = config.clearinghouseAddress as `0x${string}`;
      const usdc = config.usdcAddress as `0x${string}`;
      const payer = address as `0x${string}`;
      const recipient = pl.recipient as `0x${string}`;
      const totalAllocationPool = BigInt(pl.amount);
      const flowVelocityPerSecond = BigInt(pl.flowVelocityPerSecond);
      const lifespanSeconds = BigInt(pl.lifespanSeconds);
      const genesisTimestamp = BigInt(Math.floor(Date.now() / 1000));

      // Rebuild canonical metadata with the payer as originator (a request link is
      // unsigned; the link's metadataHash is advisory). Fresh hash → fresh paycardId.
      const metadata: CanonicalMetadataV1 = {
        version: "openrails-metadata-v1",
        mode: "railsflow",
        originator: payer,
        recipient,
        token: usdc,
        amount: totalAllocationPool.toString(),
        flowVelocityPerSecond: flowVelocityPerSecond.toString(),
        lifespanSeconds: Number(lifespanSeconds),
        ...(pl.workflowId ? { workflowId: pl.workflowId } : {}),
        ...(pl.metadataRef ? { metadataRef: pl.metadataRef } : {}),
      };
      const metadataHash = hashOpenRailsMetadata(metadata);

      const { nonce } = await api.nonce(payer, 0);
      const nonceValue = BigInt(nonce);
      const paycardId = buildMetadataBoundPaycardId({ payer, nonceChannel: 0n, nonceValue, metadataHash });

      const { allowance } = await api.allowance(payer);
      if (BigInt(allowance) < totalAllocationPool) {
        setStatus({ id: "approving" });
        const approveTx = await writeContractAsync({
          address: usdc,
          abi: USDC_ABI,
          functionName: "approve",
          args: [hub, totalAllocationPool],
        });
        await publicClient!.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 });
      }

      setStatus({ id: "signing" });
      const domain = buildOpenRailsDomain(arcTestnet.id, hub);
      const message = {
        paycardId,
        metadataHash,
        recipient,
        totalAllocationPool,
        flowVelocityPerSecond,
        genesisTimestamp,
        lifespanSeconds,
        residualDeltaRecipient: payer,
        nonceChannel: 0n,
        nonceValue,
      } as const;
      const sig = await signTypedDataAsync({
        domain,
        types: OPENRAILS_EIP712_TYPES,
        primaryType: "SettlementIntent",
        message,
      });

      setStatus({ id: "submitting" });
      const openArgs = [
        paycardId,
        metadataHash,
        recipient,
        totalAllocationPool,
        flowVelocityPerSecond,
        genesisTimestamp,
        lifespanSeconds,
        payer,
        sig,
        0n,
        nonceValue,
        payer, // V2: explicit payer (connected wallet); verified via SignatureChecker
      ] as const;
      const txHash = await writeContractAsync({
        address: hub,
        abi: HUB_ABI,
        functionName: "openPaycardChannel",
        args: openArgs,
      });
      await publicClient!.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
      setStatus({ id: "success", txHash, paycardId });
    } catch (e) {
      setStatus({ id: "error", msg: actionErrorMessage(e) });
    }
  }

  /**
   * Pay a RailsFlow request gaslessly: the connected wallet signs the intent AND an EIP-2612
   * permit (no approval tx, no open tx), and the keeper relay lands both. On Arc gas == USDC, so
   * the payer isn't "gasless" in the asset sense — the win is no approval tx and the keeper pays
   * gas; the payer still funds the escrow per the signed intent.
   */
  async function payRailsFlowSponsored(artifact: OpenRailsLinkArtifact): Promise<void> {
    if (!config) return setStatus({ id: "error", msg: "Config not loaded." });
    if (!address) return setStatus({ id: "error", msg: "Connect a wallet first." });
    
    // Enforce switching to Arc Testnet
    if (chainId !== arcTestnet.id) {
      try {
        await switchChainAsync({ chainId: arcTestnet.id });
      } catch (err) {
        return setStatus({ id: "error", msg: "Please switch your wallet network to Arc Testnet." });
      }
    }

    const pl = artifact.payload as RailsFlowLinkPayload;
    if (pl.expiresAt && Date.now() / 1000 > pl.expiresAt) {
      return setStatus({ id: "error", msg: "This request link has expired." });
    }
    try {
      const hub = config.clearinghouseAddress as `0x${string}`;
      const usdc = config.usdcAddress as `0x${string}`;
      const payer = address as `0x${string}`;
      const recipient = pl.recipient as `0x${string}`;
      const totalAllocationPool = BigInt(pl.amount);
      const flowVelocityPerSecond = BigInt(pl.flowVelocityPerSecond);
      const lifespanSeconds = BigInt(pl.lifespanSeconds);
      const genesisTimestamp = BigInt(Math.floor(Date.now() / 1000));

      const metadata: CanonicalMetadataV1 = {
        version: "openrails-metadata-v1",
        mode: "railsflow",
        originator: payer,
        recipient,
        token: usdc,
        amount: totalAllocationPool.toString(),
        flowVelocityPerSecond: flowVelocityPerSecond.toString(),
        lifespanSeconds: Number(lifespanSeconds),
        ...(pl.workflowId ? { workflowId: pl.workflowId } : {}),
        ...(pl.metadataRef ? { metadataRef: pl.metadataRef } : {}),
      };
      const metadataHash = hashOpenRailsMetadata(metadata);

      const { nonce } = await api.nonce(payer, 0);
      const nonceValue = BigInt(nonce);
      const paycardId = buildMetadataBoundPaycardId({ payer, nonceChannel: 0n, nonceValue, metadataHash });

      setStatus({ id: "signing" });
      const domain = buildOpenRailsDomain(arcTestnet.id, hub);
      const message = {
        paycardId,
        metadataHash,
        recipient,
        totalAllocationPool,
        flowVelocityPerSecond,
        genesisTimestamp,
        lifespanSeconds,
        residualDeltaRecipient: payer,
        nonceChannel: 0n,
        nonceValue,
      } as const;
      const sig = await signTypedDataAsync({
        domain,
        types: OPENRAILS_EIP712_TYPES,
        primaryType: "SettlementIntent",
        message,
      });

      // Serialize the signed envelope (types match the relay's decoder: pool/velocity as strings,
      // timestamps/nonces as numbers).
      const envelope: CryptographicEnvelopeV1 = {
        payerAddress: payer,
        envelopeSignature: sig,
        intent: {
          paycardId,
          metadataHash,
          recipient,
          totalAllocationPool: totalAllocationPool.toString(),
          flowVelocityPerSecond: flowVelocityPerSecond.toString(),
          genesisTimestamp: Number(genesisTimestamp),
          lifespanSeconds: Number(lifespanSeconds),
          residualDeltaRecipient: payer,
          nonceChannel: 0,
          nonceValue: Number(nonceValue),
        },
        mode: "railsflow",
        metadata,
      };
      const envelopeToken = serializeEnvelope(envelope);

      // Gasless approval via permit — replaces the ERC-20 approve tx.
      const permit = await signFlowPermit({
        publicClient: publicClient!,
        signTypedDataAsync,
        owner: payer,
        token: usdc,
        spender: hub,
        value: totalAllocationPool,
        chainId: arcTestnet.id,
      });

      setStatus({ id: "submitting" });
      const res = await fetch(`${RELAY_URL}/relay-open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ envelopeToken, permit }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setStatus({ id: "success", txHash: data.txHash, paycardId: data.paycardId ?? paycardId });
    } catch (e) {
      setStatus({ id: "error", msg: actionErrorMessage(e) });
    }
  }

  /** Dispatch by link kind: RailsCard → claim, RailsFlow → pay. */
  async function act(artifact: OpenRailsLinkArtifact): Promise<void> {
    if (artifact.kind === "railscard") return claimRailsCard(artifact);
    return payRailsFlow(artifact);
  }

  return { config, conn, address, status, busy, act, claimRailsCard, claimRailsCardSponsored, payRailsFlow, payRailsFlowSponsored, reset };
}
