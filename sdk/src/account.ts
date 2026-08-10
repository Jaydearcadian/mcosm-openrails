/**
 * @module account
 * @description Pluggable account abstraction for OpenRails.
 *
 * OpenRails authenticates the *signature*, not the sender — the Hub recovers the
 * payer from an EIP-712 signature via `ecrecover` and never checks `msg.sender`.
 * So most accounts only need to **sign**; submission can be sponsored by a relayer
 * (see {@link module:relay}). That is why the interface is split in two:
 *
 * - {@link OpenRailsAccount} — sign-only. Enough for gasless (relayed) opens/claims.
 *   Satisfied by embedded EOAs (Privy/Turnkey/Web3Auth) and server wallets.
 * - {@link OpenRailsSubmitter} — also submits its own transactions (self-submit path).
 *   Any `ethers.Signer` satisfies it.
 *
 * The V2 Hub uses SignatureChecker and accepts EOA or EIP-1271 signatures. Adapters still need
 * to provide the account-specific signing implementation.
 */
import type { ethers } from 'ethers';

/** The minimal capability OpenRails needs to authorize an intent or a permit. */
export interface OpenRailsAccount {
  /** Optional flag indicating this is a smart contract account. */
  isSmartAccount?: boolean;
  /** Returns the account's address (checksummed by convention). */
  getAddress(): Promise<string>;
  /**
   * Produces an EIP-712 signature. Used for both SettlementIntents and EIP-2612
   * permits — a permit is just another typed-data payload.
   */
  signTypedData(
    domain: ethers.TypedDataDomain,
    types: Record<string, ethers.TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string>;
}

/** Result of broadcasting a transaction — the common subset we depend on. */
export interface SubmittedTransaction {
  hash: string;
  wait(): Promise<unknown>;
}

/** An account that can also broadcast its own transactions (self-submit path). */
export interface OpenRailsSubmitter extends OpenRailsAccount {
  sendTransaction(tx: ethers.TransactionRequest): Promise<SubmittedTransaction>;
}
