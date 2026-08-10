export const UINT256_MAX = (1n << 256n) - 1n;
const MAX_SAFE_NONCE_CHANNEL = BigInt(Number.MAX_SAFE_INTEGER);

export function railsCardNonceChannelFromWords(high: number, low: number): bigint {
  const channel = (BigInt(high & 0x1fffff) << 32n) | BigInt(low >>> 0);
  return channel === 0n ? 1n : channel;
}

export function randomRailsCardNonceChannel(): bigint {
  const words = globalThis.crypto.getRandomValues(new Uint32Array(2));
  const channel = railsCardNonceChannelFromWords(words[0], words[1]);
  if (channel > MAX_SAFE_NONCE_CHANNEL) throw new Error("RailsCard nonce channel is not safely serializable.");
  return channel;
}

export interface RailsCardFundingState {
  expectedNonce: bigint;
  currentNonce: bigint;
  balance: bigint;
  allowance: bigint;
  allocation: bigint;
  permit?: {
    owner: string;
    spender: string;
    value: string;
    deadline: number;
  };
  payer: string;
  hub: string;
  nowSeconds?: number;
}

export type RailsCardFundingDecision =
  | { ok: true; needsPermit: boolean }
  | { ok: false; code: "stale" | "balance" | "expired" | "authorization"; message: string };

export function nextRailsCardAllowance(currentAllowance: bigint, allocation: bigint): bigint {
  if (allocation <= 0n) throw new Error("RailsCard allocation must be positive.");
  if (currentAllowance >= UINT256_MAX - allocation) return UINT256_MAX;
  return currentAllowance + allocation;
}

export function evaluateRailsCardFunding(state: RailsCardFundingState): RailsCardFundingDecision {
  if (state.currentNonce !== state.expectedNonce) {
    return {
      ok: false,
      code: "stale",
      message: "This RailsCard is stale or has already been claimed. Ask the sender to reissue it.",
    };
  }
  if (state.balance < state.allocation) {
    return {
      ok: false,
      code: "balance",
      message: "The sender no longer has enough USDC for this RailsCard. Ask the sender to reissue it.",
    };
  }
  if (state.allowance >= state.allocation) return { ok: true, needsPermit: false };

  const permit = state.permit;
  if (!permit) {
    return {
      ok: false,
      code: "authorization",
      message: "The sender's RailsCard authorization is unavailable. Ask the sender to reissue it.",
    };
  }

  const ownerMatches = permit.owner.toLowerCase() === state.payer.toLowerCase();
  const spenderMatches = permit.spender.toLowerCase() === state.hub.toLowerCase();
  const valueCoversCard = BigInt(permit.value) >= state.allocation;
  if (!ownerMatches || !spenderMatches || !valueCoversCard) {
    return {
      ok: false,
      code: "authorization",
      message: "The sender's RailsCard authorization is invalid. Ask the sender to reissue it.",
    };
  }

  const now = state.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (permit.deadline <= now) {
    return {
      ok: false,
      code: "expired",
      message: "The sender's RailsCard authorization expired. Ask the sender to reissue it.",
    };
  }
  return { ok: true, needsPermit: true };
}
