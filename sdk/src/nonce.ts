/**
 * @module nonce
 * @description Nonce management for the OpenRails V1 arc-policy-envelope layer.
 *
 * Nonces are scoped to `(account, channel)` pairs. The channel is derived
 * deterministically from a task-type string so that independent workloads
 * avoid contention while preserving replay protection within each lane.
 */
import { randomBytes } from 'ethers';

const MAX_SAFE_NONCE_CHANNEL = BigInt(Number.MAX_SAFE_INTEGER);

/** Generate a non-zero nonce lane that survives JSON number serialization exactly. */
export function randomRailsCardNonceChannel(): number {
  const bytes = randomBytes(7);
  let channel = 0n;
  for (const byte of bytes) channel = (channel << 8n) | BigInt(byte);
  channel &= MAX_SAFE_NONCE_CHANNEL;
  return Number(channel === 0n ? 1n : channel);
}

// ---------------------------------------------------------------------------
// Cache adapter interface
// ---------------------------------------------------------------------------

/**
 * Minimal async key-value store contract for nonce persistence.
 * Implement this interface to back nonce state with Redis, SQLite, etc.
 */
export interface LocalNonceCacheAdapter {
  /** Retrieve the current nonce value for a composite key, or `undefined` if unset. */
  get(key: string): Promise<number | undefined>;
  /** Persist a nonce value under a composite key. */
  set(key: string, value: number): Promise<void>;
  /** Remove a composite key from the store. */
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// In-memory adapter (default / testing)
// ---------------------------------------------------------------------------

/**
 * Simple in-memory nonce cache backed by a `Map`. Suitable for single-process
 * environments and test harnesses; state is lost on restart.
 */
export class MemoryNonceCacheAdapter implements LocalNonceCacheAdapter {
  private readonly store = new Map<string, number>();

  async get(key: string): Promise<number | undefined> {
    return this.store.get(key);
  }

  async set(key: string, value: number): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Nonce engine
// ---------------------------------------------------------------------------

/**
 * Manages monotonically increasing nonces across multiple channels.
 *
 * Each `(account, channel)` pair maintains an independent sequence starting
 * at 0. Channels are selected deterministically from a task-type descriptor
 * so that unrelated workloads occupy separate lanes.
 */
export class NonceEngine {
  private readonly adapter: LocalNonceCacheAdapter;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(adapter: LocalNonceCacheAdapter) {
    this.adapter = adapter;
  }

  // -----------------------------------------------------------------------
  // Channel selection
  // -----------------------------------------------------------------------

  /**
   * Map a human-readable task type (e.g. `"inference"`, `"embedding"`) to a
   * deterministic channel number in the range `[0, 255]`.
   *
   * Uses a simple DJB2-style hash folded into a single byte.
   *
   * @param taskType - arbitrary task descriptor string
   * @returns channel index `0..255`
   */
  public selectChannel(taskType: string): number {
    let hash = 5381;
    for (let i = 0; i < taskType.length; i++) {
      // hash * 33 + charCode, kept within 32-bit signed range
      hash = ((hash << 5) + hash + taskType.charCodeAt(i)) | 0;
    }
    return Math.abs(hash) % 256;
  }

  // -----------------------------------------------------------------------
  // Nonce lifecycle
  // -----------------------------------------------------------------------

  /**
   * Build the composite cache key for a given account and channel.
   */
  private cacheKey(account: string, channel: number): string {
    return `nonce:${account.toLowerCase()}:${channel}`;
  }

  private async withKeyLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.then(() => current);
    this.locks.set(key, next);

    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(key) === next) {
        this.locks.delete(key);
      }
    }
  }

  /**
   * Atomically read-then-increment the nonce for the specified account and
   * channel. Returns the value that should be included in the current intent.
   *
   * @param account - signer address (case-insensitive)
   * @param channel - channel index (0-255)
   * @returns the nonce value to use for this intent
   */
  public async nextNonce(account: string, channel: number): Promise<number> {
    const key = this.cacheKey(account, channel);
    return this.withKeyLock(key, async () => {
      const current = (await this.adapter.get(key)) ?? 0;
      await this.adapter.set(key, current + 1);
      return current;
    });
  }

  /**
   * Read the current nonce for an account + channel without side effects.
   *
   * @param account - signer address (case-insensitive)
   * @param channel - channel index (0-255)
   * @returns the next nonce that would be issued, or `0` if none has been set
   */
  public async currentNonce(account: string, channel: number): Promise<number> {
    const key = this.cacheKey(account, channel);
    return (await this.adapter.get(key)) ?? 0;
  }
}
