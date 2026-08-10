import { useCallback, useState } from "react";
import { parseEventLogs, type Hex } from "viem";
import { HUB_ABI } from "./contracts";
import {
  buildCircleSettlementPlan,
  circleErrorLabel,
  classifyCircleError,
  encodeCircleSettlementCalls,
  normalizeCircleVaultState,
  verifyCircleProvisionEvent,
  verifyCircleVaultState,
  type CircleErrorState,
  type CircleSettlementInput,
  type CircleSettlementPlan,
} from "./circleModular";
import {
  OPENRAILS_EIP712_TYPES,
  type OpenRailsIntentV1,
} from "./intents";
import { useCircleModularWallet, type CircleWalletConnection } from "./circleModularWallet";

export type CircleSettlementStatus =
  | { id: "idle" }
  | { id: "missing-config"; msg: string }
  | { id: "connect-required"; msg: string }
  | { id: "preparing" }
  | { id: "awaiting-passkey" }
  | { id: "sponsorship-pending"; userOpHash: string }
  | { id: "receipt-pending"; userOpHash: string }
  | { id: "verifying-vault"; userOpHash: string; txHash: string }
  | { id: "confirmed"; userOpHash: string; txHash: string; paycardId: string; payer: string }
  | {
      id: CircleErrorState;
      msg: string;
      userOpHash?: string;
      txHash?: string;
    };

export interface CircleSettlementParams extends Omit<CircleSettlementInput, "payer" | "nonceValue"> {}

export interface CircleSettlementResult {
  userOpHash: Hex;
  txHash: Hex;
  paycardId: string;
  payer: string;
  receiptVerified: true;
  vaultVerified: true;
}

export class CircleSettlementExecutionError extends Error {
  readonly state: CircleErrorState;
  readonly userOpHash?: Hex;
  readonly txHash?: Hex;

  constructor(state: CircleErrorState, message: string, userOpHash?: Hex, txHash?: Hex) {
    super(message);
    this.name = "CircleSettlementExecutionError";
    this.state = state;
    this.userOpHash = userOpHash;
    this.txHash = txHash;
  }
}

type CircleStatusUpdate = (status: CircleSettlementStatus) => void;

function setFailure(
  update: CircleStatusUpdate,
  state: CircleErrorState,
  userOpHash?: Hex,
  txHash?: Hex,
  reason?: string,
): CircleSettlementExecutionError {
  const message = state === "receipt-verification-failure" && reason ? reason : circleErrorLabel(state);
  const error = new CircleSettlementExecutionError(state, message, userOpHash, txHash);
  update({ id: state, msg: message, userOpHash, txHash });
  return error;
}

function typedDataSigner(account: CircleWalletConnection["account"]): {
  signTypedData(args: {
    domain: Record<string, unknown>;
    types: typeof OPENRAILS_EIP712_TYPES;
    primaryType: "SettlementIntent";
    message: OpenRailsIntentV1;
  }): Promise<Hex>;
} {
  // Circle's official SmartAccount satisfies the existing circleToAccount signing shape. Keep the
  // host-side adapter boundary narrow and avoid treating the account as an EOA.
  return account as unknown as {
    signTypedData(args: {
      domain: Record<string, unknown>;
      types: typeof OPENRAILS_EIP712_TYPES;
      primaryType: "SettlementIntent";
      message: OpenRailsIntentV1;
    }): Promise<Hex>;
  };
}

async function readNonceAndBalance(connection: CircleWalletConnection, planInput: CircleSettlementParams) {
  const payer = connection.address;
  const [nonceValue, balance] = await Promise.all([
    connection.publicClient.readContract({
      address: planInput.hubAddress as `0x${string}`,
      abi: HUB_ABI,
      functionName: "accountNonceTracks",
      args: [payer, 0n],
    }),
    connection.publicClient.readContract({
      address: planInput.usdcAddress as `0x${string}`,
      abi: [
        {
          type: "function",
          name: "balanceOf",
          stateMutability: "view",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
        },
      ] as const,
      functionName: "balanceOf",
      args: [payer],
    }),
  ]);
  return { nonceValue: nonceValue as bigint, balance: balance as bigint };
}

export async function executeCircleSettlement(
  connection: CircleWalletConnection,
  input: CircleSettlementParams,
  update: CircleStatusUpdate = () => {},
): Promise<CircleSettlementResult> {
  let plan: CircleSettlementPlan | undefined;
  let userOpHash: Hex | undefined;
  let txHash: Hex | undefined;

  try {
    update({ id: "preparing" });
    const payer = await connection.account.getAddress();
    if (payer.toLowerCase() !== connection.address.toLowerCase()) {
      throw setFailure(update, "receipt-verification-failure", undefined, undefined, "Circle smart-account payer changed during preparation.");
    }

    const { nonceValue, balance } = await readNonceAndBalance(connection, input);
    plan = buildCircleSettlementPlan({ ...input, payer, nonceValue });
    if (balance < plan.approvalAmount) {
      throw setFailure(update, "insufficient-balance");
    }

    update({ id: "awaiting-passkey" });
    const envelopeSignature = await typedDataSigner(connection.account).signTypedData({
      domain: plan.domain,
      types: OPENRAILS_EIP712_TYPES,
      primaryType: "SettlementIntent",
      message: plan.intent,
    });
    const calls = encodeCircleSettlementCalls(plan, envelopeSignature);

    update({ id: "sponsorship-pending", userOpHash: "pending" });
    userOpHash = await connection.bundlerClient.sendUserOperation({
      calls,
      paymaster: true,
    });
    update({ id: "receipt-pending", userOpHash });

    const userOpReceipt = await connection.bundlerClient.waitForUserOperationReceipt({ hash: userOpHash });
    if (!userOpReceipt.success || userOpReceipt.receipt.status !== "success") {
      throw setFailure(update, "transaction-reverted", userOpHash, userOpReceipt.receipt.transactionHash);
    }
    txHash = userOpReceipt.receipt.transactionHash;

    const transactionReceipt = await connection.publicClient.waitForTransactionReceipt({ hash: txHash });
    if (transactionReceipt.status !== "success") {
      throw setFailure(update, "transaction-reverted", userOpHash, txHash);
    }

    update({ id: "verifying-vault", userOpHash, txHash });
    const parsedEvents = parseEventLogs({
      abi: HUB_ABI,
      eventName: "PaycardProvisioned",
      logs: transactionReceipt.logs,
      strict: false,
    });
    if (parsedEvents.length !== 1) {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, "Receipt did not contain exactly one OpenRails provision event.");
    }
    const event = parsedEvents[0]?.args as unknown as {
      paycardId: string;
      payer: string;
      recipient: string;
      metadataHash: string;
      poolAllocation: bigint;
      flowVelocityPerSecond: bigint;
      genesisTimestamp: bigint;
      lifespanSeconds: bigint;
    } | undefined;
    if (!event) {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, "Receipt did not contain the expected OpenRails provision event.");
    }
    let eventVerification;
    try {
      eventVerification = verifyCircleProvisionEvent(event, plan, payer);
    } catch {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, "Receipt event fields were invalid.");
    }
    if (!eventVerification.ok) {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, eventVerification.reason);
    }

    const rawVaultState = await connection.publicClient.readContract({
      address: plan.hubAddress,
      abi: HUB_ABI,
      functionName: "registry",
      args: [plan.intent.paycardId],
    });
    const vaultState = normalizeCircleVaultState(rawVaultState);
    if (!vaultState) {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, "The live Vault registry row was empty.");
    }
    let vaultVerification;
    try {
      vaultVerification = verifyCircleVaultState(vaultState, plan, payer);
    } catch {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, "Live Vault fields were invalid.");
    }
    if (!vaultVerification.ok) {
      throw setFailure(update, "receipt-verification-failure", userOpHash, txHash, vaultVerification.reason);
    }

    return {
      userOpHash,
      txHash,
      paycardId: plan.intent.paycardId,
      payer,
      receiptVerified: true,
      vaultVerified: true,
    };
  } catch (cause) {
    if (cause instanceof CircleSettlementExecutionError) throw cause;
    const state = classifyCircleError(cause);
    throw setFailure(update, state, userOpHash, txHash);
  }
}

function statusBusy(status: CircleSettlementStatus): boolean {
  return status.id === "preparing" || status.id === "awaiting-passkey" || status.id === "sponsorship-pending" || status.id === "receipt-pending" || status.id === "verifying-vault";
}

export function useCircleSettlement() {
  const { config, wallet } = useCircleModularWallet();
  const [status, setStatus] = useState<CircleSettlementStatus>({ id: "idle" });

  const execute = useCallback(
    async (input: CircleSettlementParams): Promise<CircleSettlementResult | undefined> => {
      if (config.id !== "ready") {
        const next = { id: "missing-config", msg: config.reason } as const;
        setStatus(next);
        return undefined;
      }
      if (!wallet) {
        const next = { id: "connect-required", msg: "Create or log in to a Circle passkey first." } as const;
        setStatus(next);
        return undefined;
      }
      try {
        const result = await executeCircleSettlement(wallet, input, setStatus);
        setStatus({
          id: "confirmed",
          userOpHash: result.userOpHash,
          txHash: result.txHash,
          paycardId: result.paycardId,
          payer: result.payer,
        });
        return result;
      } catch {
        return undefined;
      }
    },
    [config, wallet],
  );

  const reset = useCallback(() => setStatus({ id: "idle" }), []);
  return { status, busy: statusBusy(status), execute, reset };
}

export function circleSettlementStatusLabel(status: CircleSettlementStatus): string {
  switch (status.id) {
    case "idle":
      return "";
    case "missing-config":
    case "connect-required":
    case "user-rejected":
    case "sponsorship-denied":
    case "insufficient-balance":
    case "rpc-failure":
    case "transaction-reverted":
    case "receipt-verification-failure":
      return status.msg;
    case "preparing":
      return "Preparing exact settlement terms...";
    case "awaiting-passkey":
      return "Approve the settlement with your passkey...";
    case "sponsorship-pending":
      return "Requesting Circle Gas Station sponsorship...";
    case "receipt-pending":
      return "Waiting for the sponsored transaction receipt...";
    case "verifying-vault":
      return "Verifying the receipt and live Vault state...";
    case "confirmed":
      return "Confirmed and verified on Arc Testnet.";
  }
}
