/**
 * Unified payment creation flow for RailsFlow requests and signed RailsCards.
 * Deferred RailsCards use independent nonce lanes so multiple outstanding cards
 * can be redeemed in any order without invalidating one another.
 */
import { useCallback, useState } from "react";
import {
  useAccount,
  usePublicClient,
  useReadContract,
  useSignTypedData,
  useSwitchChain,
  useWriteContract,
} from "wagmi";
import { arcTestnet } from "./chain";
import { HUB_ABI, USDC_ABI } from "./contracts";
import {
  type CanonicalMetadataV1,
  OPENRAILS_EIP712_TYPES,
  ZERO_ADDRESS,
  buildMetadataBoundPaycardId,
  buildOpenRailsDomain,
  hashOpenRailsMetadata,
  randomPaycardId,
  serializeEnvelope,
} from "./intents";
import { appBaseUrl, createRailsCardClaimLink, createRailsFlowRequestLink } from "./links";
import { randomRailsCardNonceChannel } from "./nonceLane";
import { signFlowPermit } from "./permit";

const RELAY_URL =
  (import.meta.env.VITE_OPENRAILS_RELAY_URL as string | undefined) ??
  "https://openrails-reconciliation-worker.microcosm.workers.dev";

const MAX_NONCE_LANE_SELECTION_ATTEMPTS = 5;

export type NewPaymentMode = "railsflow" | "railscard";
export type NewPaymentCardVariant = "bearer" | "bound";
export type NewPaymentType = "one-time" | "streaming";

export interface NewPaymentParams {
  mode: NewPaymentMode;
  cardVariant: NewPaymentCardVariant;
  type: NewPaymentType;
  party: string;
  amountUsdc: string;
  velocityUsdcPerSec?: string;
  lifespanSeconds?: string;
  memo?: string;
  workflowId?: string;
}

export type NewPaymentStatus =
  | { id: "idle" }
  | { id: "approving" }
  | { id: "signing" }
  | { id: "submitting" }
  | { id: "success"; txHash: string; paycardId: string }
  | { id: "error"; msg: string };

function resolvedEnvelopeMode(
  p: NewPaymentParams,
): "railsflow" | "railscard_bearer" | "railscard_recipient_bound" {
  if (p.mode === "railsflow") return "railsflow";
  return p.cardVariant === "bearer" ? "railscard_bearer" : "railscard_recipient_bound";
}

function validate(p: NewPaymentParams, hubAddress: string, balance?: bigint): string | null {
  if (!hubAddress) return "Config not loaded.";

  const addrRe = /^0x[0-9a-fA-F]{40}$/;
  const needsParty = p.mode === "railsflow" || (p.mode === "railscard" && p.cardVariant === "bound");
  if (needsParty && !addrRe.test(p.party)) return "Invalid recipient address.";
  if (p.party && !addrRe.test(p.party)) return "Invalid address.";

  const amount = Number.parseFloat(p.amountUsdc);
  if (!Number.isFinite(amount) || amount <= 0) return "Invalid amount.";

  if (p.type === "streaming") {
    const velocity = Number.parseFloat(p.velocityUsdcPerSec ?? "");
    const lifespan = Number.parseFloat(p.lifespanSeconds ?? "");
    if (!Number.isFinite(velocity) || velocity <= 0) return "Invalid velocity.";
    if (!Number.isFinite(lifespan) || lifespan <= 0) return "Invalid lifespan.";
  }

  if (balance !== undefined) {
    const totalAllocationPool = BigInt(Math.round(amount * 1_000_000));
    if (totalAllocationPool > balance) {
      const balanceUsdc = (Number(balance) / 1_000_000).toFixed(2);
      return `Amount exceeds your wallet's USDC balance (${balanceUsdc} available).`;
    }
  }

  return null;
}

function buildIntentParts(
  p: NewPaymentParams,
  payer: `0x${string}`,
  usdcAddress: `0x${string}`,
) {
  const envelopeMode = resolvedEnvelopeMode(p);
  const isBearer = envelopeMode === "railscard_bearer";
  const signedRecipient = (isBearer ? ZERO_ADDRESS : p.party) as `0x${string}`;
  const isOneTime = p.type === "one-time";
  const totalAllocationPool = BigInt(Math.round(Number.parseFloat(p.amountUsdc) * 1_000_000));
  const flowVelocityPerSecond = isOneTime
    ? 0n
    : BigInt(Math.round(Number.parseFloat(p.velocityUsdcPerSec!) * 1_000_000));
  const lifespanSeconds = isOneTime
    ? 0n
    : BigInt(Math.round(Number.parseFloat(p.lifespanSeconds!)));

  const metadata: CanonicalMetadataV1 = {
    version: "openrails-metadata-v1",
    mode: envelopeMode,
    originator: payer,
    recipient: p.party || "",
    token: usdcAddress,
    amount: totalAllocationPool.toString(),
    flowVelocityPerSecond: flowVelocityPerSecond.toString(),
    lifespanSeconds: Number(lifespanSeconds),
    ...(p.workflowId?.trim() ? { workflowId: p.workflowId.trim() } : {}),
    ...(p.memo?.trim() ? { metadataRef: p.memo.trim() } : {}),
  };

  return {
    envelopeMode,
    signedRecipient,
    totalAllocationPool,
    flowVelocityPerSecond,
    lifespanSeconds,
    metadataHash: hashOpenRailsMetadata(metadata),
  };
}

export function useNewPayment(hubAddress: string, usdcAddress: string) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { signTypedDataAsync } = useSignTypedData();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [status, setStatus] = useState<NewPaymentStatus>({ id: "idle" });

  const { data: balance, isLoading: balanceLoading } = useReadContract({
    address: usdcAddress as `0x${string}`,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!usdcAddress },
  }) as { data: bigint | undefined; isLoading: boolean };

  const busy = status.id === "approving" || status.id === "signing" || status.id === "submitting";

  const reset = useCallback(() => {
    setStatus({ id: "idle" });
  }, []);

  async function ensureArcTestnet(): Promise<void> {
    if (chainId === arcTestnet.id) return;
    try {
      await switchChainAsync({ chainId: arcTestnet.id });
    } catch {
      throw new Error("Please switch your wallet network to Arc Testnet.");
    }
  }

  async function selectUnusedRailsCardLane(
    payer: `0x${string}`,
    hub: `0x${string}`,
  ): Promise<bigint> {
    if (!publicClient) throw new Error("Arc public client is not available.");

    for (let attempt = 0; attempt < MAX_NONCE_LANE_SELECTION_ATTEMPTS; attempt += 1) {
      const candidate = randomRailsCardNonceChannel();
      const currentNonce = (await publicClient.readContract({
        address: hub,
        abi: HUB_ABI,
        functionName: "accountNonceTracks",
        args: [payer, candidate],
      })) as bigint;

      if (currentNonce === 0n) return candidate;
    }

    throw new Error("Could not allocate an unused RailsCard nonce lane. Try again.");
  }

  async function generateLink(p: NewPaymentParams): Promise<string> {
    if (p.mode === "railsflow") {
      const err = validate(p, hubAddress);
      if (err) throw new Error(err);

      const totalAllocationPool = BigInt(Math.round(Number.parseFloat(p.amountUsdc) * 1_000_000));
      const isOneTime = p.type === "one-time";
      const flowVelocityPerSecond = isOneTime
        ? 0n
        : BigInt(Math.round(Number.parseFloat(p.velocityUsdcPerSec!) * 1_000_000));
      const lifespanSeconds = isOneTime
        ? 0n
        : BigInt(Math.round(Number.parseFloat(p.lifespanSeconds!)));

      return createRailsFlowRequestLink({
        appBaseUrl: appBaseUrl(),
        chainId: arcTestnet.id,
        vault: hubAddress,
        token: usdcAddress,
        metadataHash: randomPaycardId(),
        payload: {
          mode: "railsflow",
          merchant: address ?? "",
          recipient: p.party,
          amount: totalAllocationPool.toString(),
          flowVelocityPerSecond: flowVelocityPerSecond.toString(),
          lifespanSeconds: Number(lifespanSeconds),
          workflowId: p.workflowId?.trim() || undefined,
          metadataRef: p.memo?.trim() || undefined,
        },
      });
    }

    if (!address) throw new Error("Connect a wallet first.");
    if (!publicClient) throw new Error("Arc public client is not available.");

    const err = validate(p, hubAddress, balance);
    if (err) throw new Error(err);

    await ensureArcTestnet();

    const payer = address as `0x${string}`;
    const hub = hubAddress as `0x${string}`;
    const usdc = usdcAddress as `0x${string}`;
    const {
      envelopeMode,
      signedRecipient,
      totalAllocationPool,
      flowVelocityPerSecond,
      lifespanSeconds,
      metadataHash,
    } = buildIntentParts(p, payer, usdc);

    const nonceChannel = await selectUnusedRailsCardLane(payer, hub);
    const nonceValue = 0n;
    const paycardId =
      envelopeMode === "railscard_bearer"
        ? randomPaycardId()
        : buildMetadataBoundPaycardId({ payer, nonceChannel, nonceValue, metadataHash });
    const genesisTimestamp = BigInt(Math.floor(Date.now() / 1000));

    const domain = buildOpenRailsDomain(arcTestnet.id, hub);
    const message = {
      paycardId,
      metadataHash,
      recipient: signedRecipient,
      totalAllocationPool,
      flowVelocityPerSecond,
      genesisTimestamp,
      lifespanSeconds,
      residualDeltaRecipient: payer,
      nonceChannel,
      nonceValue,
    } as const;

    setStatus({ id: "signing" });
    const signature = await signTypedDataAsync({
      domain,
      types: OPENRAILS_EIP712_TYPES,
      primaryType: "SettlementIntent",
      message,
    });

    const permit = await signFlowPermit({
      publicClient,
      signTypedDataAsync,
      owner: payer,
      token: usdc,
      spender: hub,
      value: totalAllocationPool,
      chainId: arcTestnet.id,
    });

    const envelopeToken = serializeEnvelope({
      payerAddress: payer,
      envelopeSignature: signature,
      intent: {
        paycardId,
        metadataHash,
        recipient: signedRecipient,
        totalAllocationPool: totalAllocationPool.toString(),
        flowVelocityPerSecond: flowVelocityPerSecond.toString(),
        genesisTimestamp: Number(genesisTimestamp),
        lifespanSeconds: Number(lifespanSeconds),
        residualDeltaRecipient: payer,
        nonceChannel: nonceChannel.toString(),
        nonceValue: nonceValue.toString(),
      },
      mode: envelopeMode,
      permit,
    });

    setStatus({ id: "idle" });

    return createRailsCardClaimLink({
      appBaseUrl: appBaseUrl(),
      chainId: arcTestnet.id,
      vault: hubAddress,
      token: usdcAddress,
      metadataHash,
      payload: {
        mode: envelopeMode as "railscard_bearer" | "railscard_recipient_bound",
        envelopeToken,
        claimHint: p.party || undefined,
      },
    });
  }

  async function submit(
    p: NewPaymentParams,
    path: "gasless" | "self-submit" = "gasless",
  ): Promise<void> {
    if (!address) return setStatus({ id: "error", msg: "Connect a wallet first." });
    if (!publicClient) return setStatus({ id: "error", msg: "Arc public client is not available." });
    if (p.mode === "railscard" && p.cardVariant === "bearer") {
      return setStatus({
        id: "error",
        msg: "Bearer RailsCards are claimed later by whoever holds the link — use Generate link instead.",
      });
    }

    const err = validate(p, hubAddress, balance);
    if (err) return setStatus({ id: "error", msg: err });

    try {
      await ensureArcTestnet();

      const payer = address as `0x${string}`;
      const hub = hubAddress as `0x${string}`;
      const usdc = usdcAddress as `0x${string}`;
      const {
        envelopeMode,
        signedRecipient,
        totalAllocationPool,
        flowVelocityPerSecond,
        lifespanSeconds,
        metadataHash,
      } = buildIntentParts(p, payer, usdc);

      const nonceChannel = 0n;
      const nonceValue = (await publicClient.readContract({
        address: hub,
        abi: HUB_ABI,
        functionName: "accountNonceTracks",
        args: [payer, nonceChannel],
      })) as bigint;
      const paycardId =
        envelopeMode === "railscard_bearer"
          ? randomPaycardId()
          : buildMetadataBoundPaycardId({ payer, nonceChannel, nonceValue, metadataHash });
      const genesisTimestamp = BigInt(Math.floor(Date.now() / 1000));

      const domain = buildOpenRailsDomain(arcTestnet.id, hub);
      const message = {
        paycardId,
        metadataHash,
        recipient: signedRecipient,
        totalAllocationPool,
        flowVelocityPerSecond,
        genesisTimestamp,
        lifespanSeconds,
        residualDeltaRecipient: payer,
        nonceChannel,
        nonceValue,
      } as const;

      if (path === "gasless") {
        setStatus({ id: "signing" });
        const signature = await signTypedDataAsync({
          domain,
          types: OPENRAILS_EIP712_TYPES,
          primaryType: "SettlementIntent",
          message,
        });
        const envelopeToken = serializeEnvelope({
          payerAddress: payer,
          envelopeSignature: signature,
          intent: {
            paycardId,
            metadataHash,
            recipient: signedRecipient,
            totalAllocationPool: totalAllocationPool.toString(),
            flowVelocityPerSecond: flowVelocityPerSecond.toString(),
            genesisTimestamp: Number(genesisTimestamp),
            lifespanSeconds: Number(lifespanSeconds),
            residualDeltaRecipient: payer,
            nonceChannel: nonceChannel.toString(),
            nonceValue: nonceValue.toString(),
          },
          mode: envelopeMode,
        });
        const permit = await signFlowPermit({
          publicClient,
          signTypedDataAsync,
          owner: payer,
          token: usdc,
          spender: hub,
          value: totalAllocationPool,
          chainId: arcTestnet.id,
        });

        setStatus({ id: "submitting" });
        const response = await fetch(`${RELAY_URL}/relay-open`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ envelopeToken, permit }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
        setStatus({ id: "success", txHash: data.txHash, paycardId: data.paycardId ?? paycardId });
        return;
      }

      const allowance = (await publicClient.readContract({
        address: usdc,
        abi: USDC_ABI,
        functionName: "allowance",
        args: [payer, hub],
      })) as bigint;

      if (allowance < totalAllocationPool) {
        setStatus({ id: "approving" });
        const approveTx = await writeContractAsync({
          address: usdc,
          abi: USDC_ABI,
          functionName: "approve",
          args: [hub, totalAllocationPool],
        });
        await publicClient.waitForTransactionReceipt({ hash: approveTx, timeout: 120_000 });
      }

      setStatus({ id: "signing" });
      const signature = await signTypedDataAsync({
        domain,
        types: OPENRAILS_EIP712_TYPES,
        primaryType: "SettlementIntent",
        message,
      });

      setStatus({ id: "submitting" });
      const openArgs = [
        paycardId,
        metadataHash,
        signedRecipient,
        totalAllocationPool,
        flowVelocityPerSecond,
        genesisTimestamp,
        lifespanSeconds,
        payer,
        signature,
        nonceChannel,
        nonceValue,
        payer,
      ] as const;
      const txHash = await writeContractAsync({
        address: hub,
        abi: HUB_ABI,
        functionName: "openPaycardChannel",
        args: openArgs,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
      setStatus({ id: "success", txHash, paycardId });
    } catch (error) {
      setStatus({
        id: "error",
        msg: error instanceof Error ? error.message.slice(0, 240) : String(error),
      });
    }
  }

  return { status, busy, balanceLoading, submit, generateLink, reset };
}
