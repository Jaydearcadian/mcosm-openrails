import { ethers } from 'ethers';

/** Values accepted by ethers for uint256 fields without losing precision. */
export type UintLike = string | number | bigint;

/** Normalize an unsigned integer into a decimal string suitable for JSON envelopes. */
export function toUintString(value: UintLike, field = 'value'): string {
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${field} must be a non-negative safe integer when provided as a number`);
    }
    return String(value);
  }

  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${field} must be non-negative`);
    return value.toString();
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} must be an unsigned decimal integer string`);
  }
  const normalized = BigInt(value);
  if (normalized < 0n) throw new Error(`${field} must be non-negative`);
  return normalized.toString();
}

/**
 * Generate a non-zero 128-bit nonce lane as a decimal string.
 * Channel 0 remains reserved for sequential, immediate opens.
 */
export function createRandomNonceChannel(): string {
  const bytes = ethers.randomBytes(16);
  const candidate = BigInt(ethers.hexlify(bytes));
  return (candidate === 0n ? 1n : candidate).toString();
}
