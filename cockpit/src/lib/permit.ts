/**
 * EIP-2612 permit signing in the browser (wagmi + viem).
 *
 * Arc USDC supports permit, so a payer's ERC-20 approval can be a signature instead of a
 * transaction. Paired with the sponsor relay (`/relay-open`), the payer sends no tx at all —
 * the keeper lands the permit + opens the channel and pays gas. Escrow still flows from the
 * payer per the signed intent (non-custodial).
 */
import type { PublicClient } from "viem";
import { parseSignature } from "viem";
import { USDC_ABI } from "./contracts";

export interface UsdcPermit {
  owner: string;
  spender: string;
  value: string; // base units
  deadline: number;
  v: number;
  r: string;
  s: string;
}

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

/** Retry with exponential backoff — absorbs transient Arc RPC timeouts/429s. */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 3, baseMs = 500): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < maxAttempts - 1) await new Promise((r) => setTimeout(r, baseMs * 2 ** i));
    }
  }
  throw lastErr;
}

/** Sign an EIP-2612 permit for USDC using the connected wallet. Reads name/version/nonce on-chain. */
export async function signFlowPermit(params: {
  publicClient: PublicClient;
  signTypedDataAsync: (args: {
    domain: Record<string, unknown>;
    types: Record<string, { name: string; type: string }[]>;
    primaryType: string;
    message: Record<string, unknown>;
  }) => Promise<`0x${string}`>;
  owner: `0x${string}`;
  token: `0x${string}`;
  spender: `0x${string}`;
  value: bigint;
  chainId: number;
  deadlineSeconds?: number;
}): Promise<UsdcPermit> {
  const { publicClient, signTypedDataAsync, owner, token, spender, value, chainId } = params;
  const deadline = params.deadlineSeconds ?? Math.floor(Date.now() / 1000) + 3600;

  const [name, nonce, version] = await Promise.all([
    withRetry(() => publicClient.readContract({ address: token, abi: USDC_ABI, functionName: "name" }) as Promise<string>),
    withRetry(() => publicClient.readContract({ address: token, abi: USDC_ABI, functionName: "nonces", args: [owner] }) as Promise<bigint>),
    withRetry(() => (publicClient.readContract({ address: token, abi: USDC_ABI, functionName: "version" }) as Promise<string>).catch(() => "1")),
  ]);

  const domain = { name, version, chainId, verifyingContract: token };
  const message = { owner, spender, value, nonce, deadline: BigInt(deadline) };
  const sig = await signTypedDataAsync({ domain, types: PERMIT_TYPES as never, primaryType: "Permit", message });

  const { r, s, v } = parseSignature(sig);
  return { owner, spender, value: value.toString(), deadline, v: Number(v), r, s };
}
