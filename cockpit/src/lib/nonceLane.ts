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
    throw new Error(
      "RailsCard nonce channels require " +
        RAILSCARD_NONCE_CHANNEL_BYTES +
        " random bytes.",
    );
  }

  let channel = 0n;
  for (const byte of bytes) {
    channel = (channel << 8n) | BigInt(byte);
  }

  // Channel 0 is reserved for immediate, sequential payment opens.
  return channel === 0n ? 1n : channel;
}

export function randomRailsCardNonceChannel(): bigint {
  const bytes = new Uint8Array(RAILSCARD_NONCE_CHANNEL_BYTES);
  crypto.getRandomValues(bytes);
  return nonceChannelFromBytes(bytes);
}
