import { ethers } from 'ethers';
import { readNonce } from 'openrails-sdk';

export interface AllocateNonceLaneInput {
  provider: any;
  hubAddress: string;
  payer: string;
  attempts?: number;
  randomBytes?: (length: number) => Uint8Array;
}

/**
 * Allocate a fresh non-zero nonce lane for a deferred RailsCard.
 *
 * Six random bytes keep the channel inside JavaScript's safe-integer range while
 * still providing 48 bits of collision resistance. Channel 0 remains reserved
 * for immediate sequential RailsFlow opens.
 */
export async function allocateUnusedRailsCardLane(
  input: AllocateNonceLaneInput,
): Promise<{ nonceChannel: number; nonceValue: number }> {
  const attempts = input.attempts ?? 8;
  const randomBytes = input.randomBytes ?? ethers.randomBytes;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = Number(BigInt(ethers.hexlify(randomBytes(6))));
    if (!Number.isSafeInteger(candidate) || candidate === 0) continue;

    const nonceValue = await readNonce(
      input.provider,
      input.hubAddress,
      input.payer,
      candidate,
    );
    if (nonceValue === 0) return { nonceChannel: candidate, nonceValue };
  }

  throw new Error(`Could not allocate an unused RailsCard nonce lane after ${attempts} attempts`);
}
