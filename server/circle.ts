/**
 * @module circle
 *
 * Legacy server-side Circle placeholders. Server-side Programmable Wallets
 * and keyless signing are outside the approved user-controlled Modular Wallet
 * scope. These exports fail closed so callers cannot mistake synthetic data
 * for Circle infrastructure or leak credentials through logs.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compatibility shape for callers that still import the legacy placeholder. */
export interface CircleWallet {
  walletId: string;
  userId: string;
  address: string;
  /** ISO-8601 timestamp. */
  createdAt: string;
}

/** Compatibility shape for callers that still import the legacy placeholder. */
export interface WalletBalance {
  walletId: string;
  /** Human-readable USDC balance (e.g. "100.00"). */
  usdcBalance: string;
  /** Native gas token balance. */
  nativeBalance: string;
}

// ---------------------------------------------------------------------------
export class CircleIntegrationUnavailableError extends Error {
  readonly code = "CIRCLE_INTEGRATION_UNAVAILABLE" as const;

  constructor(message = "The legacy server-side Circle wallet surface is unavailable; use the browser Modular Wallet path.") {
    super(message);
    this.name = "CircleIntegrationUnavailableError";
  }
}

// CircleWalletManager
// ---------------------------------------------------------------------------

export class CircleWalletManager {
  async initialize(_apiKey: string): Promise<never> {
    throw new CircleIntegrationUnavailableError();
  }

  async createWallet(_userId: string): Promise<never> {
    throw new CircleIntegrationUnavailableError();
  }

  async getWalletBalance(_walletId: string): Promise<never> {
    throw new CircleIntegrationUnavailableError();
  }
}

// ---------------------------------------------------------------------------
// KeylessSignatureForwarder
// ---------------------------------------------------------------------------

export class KeylessSignatureForwarder {
  async forwardForSigning(_digest: string, _walletId: string): Promise<never> {
    throw new CircleIntegrationUnavailableError();
  }
}
