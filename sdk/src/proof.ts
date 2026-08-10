import { ethers } from 'ethers';
import {
  buildOpenRailsDomain,
  buildSettlementIntentValue,
  hashSettlementIntent,
  inferEnvelopeModeFromIntent,
  OPENRAILS_EIP712_TYPES,
  type CryptographicEnvelopeV1,
  type OpenRailsIntentV1,
} from './client';
import type { OpenRailsEnvelopeMode } from './metadata';

export type ProofOfPayableStage =
  | 'signed_intent'
  | 'submitted_transaction'
  | 'opened_escrow'
  | 'settlement'
  | 'residual_reclaim';

export interface ProofOfPayableV1 {
  version: 'openrails-proof-v1';
  stage: ProofOfPayableStage;
  paycardId: string;
  payer?: string;
  recipient?: string;
  intentDigest?: string;
  metadataHash?: string;
  workflowId?: string;
  mode?: OpenRailsEnvelopeMode;
  txHash?: string;
  blockNumber?: number;
  amount?: string;
  createdAt: number;
}

export function hashIntent(
  intent: OpenRailsIntentV1,
  domain: { chainId: number; verifyingContract: string },
): string {
  return hashSettlementIntent(intent, domain.chainId, domain.verifyingContract);
}

export function inferEnvelopeMode(intent: OpenRailsIntentV1): OpenRailsEnvelopeMode {
  return inferEnvelopeModeFromIntent(intent);
}

export function buildIntentProof(
  envelope: CryptographicEnvelopeV1,
  domain?: { chainId: number; verifyingContract: string },
  mode: OpenRailsEnvelopeMode =
    envelope.metadata?.mode ?? envelope.mode ?? inferEnvelopeMode(envelope.intent),
): ProofOfPayableV1 {
  const payer = domain
    ? ethers.verifyTypedData(
        buildOpenRailsDomain(domain.chainId, domain.verifyingContract),
        OPENRAILS_EIP712_TYPES,
        buildSettlementIntentValue(envelope.intent),
        envelope.envelopeSignature,
      )
    : envelope.payerAddress;

  return {
    version: 'openrails-proof-v1',
    stage: 'signed_intent',
    paycardId: envelope.intent.paycardId,
    payer,
    recipient: envelope.intent.recipient,
    metadataHash: envelope.intent.metadataHash,
    workflowId: envelope.metadata?.workflowId,
    intentDigest: domain
      ? hashSettlementIntent(envelope.intent, domain.chainId, domain.verifyingContract)
      : undefined,
    mode,
    createdAt: Math.floor(Date.now() / 1000),
  };
}

export function buildTransactionProof(params: {
  stage: Exclude<ProofOfPayableStage, 'signed_intent'>;
  paycardId: string;
  txHash: string;
  blockNumber?: number;
  payer?: string;
  recipient?: string;
  amount?: string;
  metadataHash?: string;
  workflowId?: string;
  mode?: OpenRailsEnvelopeMode;
  intentDigest?: string;
}): ProofOfPayableV1 {
  return {
    version: 'openrails-proof-v1',
    createdAt: Math.floor(Date.now() / 1000),
    ...params,
  };
}
