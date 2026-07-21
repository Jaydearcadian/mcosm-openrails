/**
 * RailsCard nonce-lane helpers.
 *
 * Deferred RailsCards must not share the sequential channel used by immediate
 * opens. A fresh 128-bit, non-zero channel gives every outstanding card an
 * independent nonce lane while remaining a valid uint256 on-chain.
 */
export const RAILSCARD_NONCE_CHANNEL_BYTES = 16;

export function nonceChannelFromBytes(bytes: Uint8Array): bigint {
  if (bytes.length !== RAILSCARD_NONCE_CHANNEL_BYTES) {
    throw new Error(`RailsCard