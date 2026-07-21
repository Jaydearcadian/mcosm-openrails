import { ethers } from 'ethers';
import { assertMbid } from './musicbrainz';

export interface CreatorRegistrationChallenge {
  artistMbid: string;
  wallet: string;
  registryOrigin: string;
  chainId: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface VerifiedCreatorRegistration extends CreatorRegistrationChallenge {
  signature: string;
  verificationStatus: 'wallet_verified';
}

export function buildCreatorRegistrationMessage(input: CreatorRegistrationChallenge): string {
  const artistMbid = assertMbid(input.artistMbid, 'artistMbid');
  const wallet = ethers.getAddress(input.wallet);
  if (!Number.isInteger(input.chainId) || input.chainId <= 0) throw new Error('chainId must be positive');
  if (!Number.isInteger(input.issuedAt) || !Number.isInteger(input.expiresAt) || input.expiresAt <= input.issuedAt) {
    throw new Error('invalid challenge time window');
  }
  if (!input.nonce.trim()) throw new Error('nonce is required');

  return [
    'OpenRails Creator Payee Registration',
    '',
    `artistMbid:${artistMbid}`,
    `wallet:${wallet}`,
    `registry:${input.registryOrigin}`,
    `chainId:${input.chainId}`,
    `issuedAt:${input.issuedAt}`,
    `expiresAt:${input.expiresAt}`,
    `nonce:${input.nonce}`,
  ].join('\n');
}

export function verifyCreatorRegistration(
  challenge: CreatorRegistrationChallenge,
  signature: string,
  now = Math.floor(Date.now() / 1000),
): VerifiedCreatorRegistration {
  if (now > challenge.expiresAt) throw new Error('creator registration challenge expired');
  if (now < challenge.issuedAt - 60) throw new Error('creator registration challenge is future-dated');

  const message = buildCreatorRegistrationMessage(challenge);
  const recovered = ethers.verifyMessage(message, signature);
  const wallet = ethers.getAddress(challenge.wallet);
  if (recovered !== wallet) throw new Error('creator registration signer does not match payout wallet');

  return {
    ...challenge,
    artistMbid: assertMbid(challenge.artistMbid, 'artistMbid'),
    wallet,
    signature,
    verificationStatus: 'wallet_verified',
  };
}

export function calculateTrackAllocation(params: {
  remainingSessionAllocation: bigint;
  velocityPerSecond: bigint;
  durationSeconds: number;
  perTrackCap?: bigint;
}): bigint {
  if (params.remainingSessionAllocation <= 0n) throw new Error('session has no remaining allocation');
  if (params.velocityPerSecond <= 0n) throw new Error('velocityPerSecond must be positive');
  if (!Number.isInteger(params.durationSeconds) || params.durationSeconds <= 0) {
    throw new Error('durationSeconds must be a positive integer');
  }
  const meteredMaximum = params.velocityPerSecond * BigInt(params.durationSeconds);
  const cap = params.perTrackCap === undefined ? meteredMaximum : params.perTrackCap;
  if (cap <= 0n) throw new Error('perTrackCap must be positive');
  return [params.remainingSessionAllocation, meteredMaximum, cap].reduce((min, value) => value < min ? value : min);
}
