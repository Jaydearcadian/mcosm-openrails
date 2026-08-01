/**
 * OpenRails MCP tool handlers — pure functions of (ctx, args) → result, kept separate from
 * transport so they're unit-testable. The Vault is the source of truth; reads are on-chain
 * projections. Signing/relay is non-custodial: the server signs with its own configured
 * account and never holds anyone else's keys.
 */
import { ethers } from 'ethers';
import {
  createRailsCardIntent,
  createRailsCardClaimLink,
  createRailsFlowRequestLink,
  parseOpenRailsLink,
  payGasless,
  claimGasless,
  signUsdcPermit,
  readPaycard,
  readNonce,
  readTokenBalance,
  randomRailsCardNonceChannel,
  reserveRailsCardAllowance,
  hashOpenRailsMetadata,
  buildMetadataBoundPaycardId,
  type CanonicalMetadataV1,
  type OpenRailsIntentV1,
  type RailsCardLinkPayloadV1,
  type RailsFlowLinkPayloadV1,
} from 'openrails-sdk';
import type { OpenRailsContext } from './context.js';

const NONCE_CHANNEL = 0;

// The SDK is compiled CommonJS; its .d.ts reference ethers' commonjs type-view, while this ESM
// package resolves ethers to its ESM view. Same runtime ethers, incompatible brand types — so we
// pass the provider through this boundary cast at SDK read calls.
const asProvider = (ctx: OpenRailsContext): any => ctx.provider;

function positiveBaseUnits(value: string, field: string): string {
  try {
    if (BigInt(value) <= 0n) throw new Error();
    return value;
  } catch {
    throw new Error(`${field} must be a positive integer in USDC base units`);
  }
}

function paymentTiming(params: {
  oneTime: boolean;
  velocityPerSecond?: string;
  lifespanSeconds?: number;
}): { velocity: string; lifespan: number } {
  if (params.oneTime) return { velocity: '0', lifespan: 0 };
  const velocity = positiveBaseUnits(params.velocityPerSecond ?? '', 'velocityPerSecond');
  const lifespan = params.lifespanSeconds;
  if (!Number.isSafeInteger(lifespan) || (lifespan ?? 0) <= 0) {
    throw new Error('lifespanSeconds must be a positive integer for streaming payments');
  }
  return { velocity, lifespan: lifespan as number };
}

function metadataFor(params: {
  mode: CanonicalMetadataV1['mode'];
  originator: string;
  recipient: string;
  token: string;
  amount: string;
  velocity: string;
  lifespan: number;
}): CanonicalMetadataV1 {
  return {
    version: 'openrails-metadata-v1',
    mode: params.mode,
    originator: params.originator,
    recipient: params.recipient,
    token: params.token,
    amount: params.amount,
    flowVelocityPerSecond: params.velocity,
    lifespanSeconds: params.lifespan,
    metadataRef: 'openrails-mcp',
  };
}

// ---- openrails_config -------------------------------------------------------
export async function openrailsConfig(ctx: OpenRailsContext) {
  let usdcBalance: string | null = null;
  if (ctx.signerAddress) {
    const bal = await readTokenBalance(asProvider(ctx), ctx.config.usdcAddress, ctx.signerAddress);
    usdcBalance = ethers.formatUnits(bal, 6);
  }
  return {
    ...ctx.config,
    signerAddress: ctx.signerAddress ?? null,
    usdcBalance,
    note: 'Vault is the source of truth; balances/state are on-chain projections. Opens/claims are gasless via the relay.',
  };
}

// ---- pay_link ---------------------------------------------------------------
export async function payLink(ctx: OpenRailsContext, args: { link: string }) {
  const artifact = parseOpenRailsLink(args.link);

  if (artifact.kind === 'railscard') {
    const pl = artifact.payload as RailsCardLinkPayloadV1;
    const account = await ctx.requireAccount();
    const claimRecipient = await account.getAddress();
    const res = await claimGasless({ relay: ctx.relay, envelopeToken: pl.envelopeToken, claimRecipient });
    return { kind: 'railscard', action: 'claimed', ...res, explorer: `${ctx.config.explorerBaseUrl}/tx/${res.txHash}` };
  }

  // RailsFlow request → pay it (the signer becomes the payer).
  const pl = artifact.payload as RailsFlowLinkPayloadV1;
  if (pl.expiresAt && Date.now() / 1000 > pl.expiresAt) throw new Error('This request link has expired.');
  const account = await ctx.requireAccount();
  const client = await ctx.requireClient();
  const payer = await account.getAddress();
  const { hubAddress: hub, usdcAddress: token, chainId } = ctx.config;

  const metadata = metadataFor({
    mode: 'railsflow', originator: payer, recipient: pl.recipient, token,
    amount: pl.amount, velocity: pl.flowVelocityPerSecond, lifespan: pl.lifespanSeconds,
  });
  const metadataHash = hashOpenRailsMetadata(metadata);
  const nonceValue = Number(await readNonce(asProvider(ctx), hub, payer, NONCE_CHANNEL));
  const paycardId = buildMetadataBoundPaycardId({ payer, nonceChannel: NONCE_CHANNEL, nonceValue, metadataHash });
  const intent: OpenRailsIntentV1 = {
    paycardId, metadataHash, recipient: pl.recipient,
    totalAllocationPool: pl.amount, flowVelocityPerSecond: pl.flowVelocityPerSecond,
    genesisTimestamp: Math.floor(Date.now() / 1000), lifespanSeconds: pl.lifespanSeconds,
    residualDeltaRecipient: payer, nonceChannel: NONCE_CHANNEL, nonceValue,
  };
  const permit = await signUsdcPermit(account, { token, spender: hub, value: pl.amount, chainId, provider: asProvider(ctx) });
  const res = await payGasless({ client, relay: ctx.relay, intent, options: { mode: 'railsflow', metadata }, permit });
  return { kind: 'railsflow', action: 'paid', ...res, explorer: `${ctx.config.explorerBaseUrl}/tx/${res.txHash}` };
}

// ---- create_request_link ----------------------------------------------------
export async function createRequestLink(
  ctx: OpenRailsContext,
  args: { amount: string; recipient?: string; oneTime?: boolean; velocityPerSecond?: string; lifespanSeconds?: number },
) {
  const recipient = ethers.getAddress(args.recipient ?? (ctx.signerAddress ?? ethers.ZeroAddress));
  if (recipient === ethers.ZeroAddress) throw new Error('recipient required (no signer configured to default to)');
  const amount = positiveBaseUnits(args.amount, 'amount');
  const oneTime = args.oneTime ?? false;
  const { velocity, lifespan } = paymentTiming({ ...args, oneTime });
  const { hubAddress: hub, usdcAddress: token, chainId, appBaseUrl } = ctx.config;

  const metadata = metadataFor({ mode: 'railsflow', originator: recipient, recipient, token, amount, velocity, lifespan });
  const link = createRailsFlowRequestLink({
    appBaseUrl, chainId, vault: hub, token, metadataHash: hashOpenRailsMetadata(metadata),
    payload: { mode: 'railsflow', merchant: recipient, recipient, amount, flowVelocityPerSecond: velocity, lifespanSeconds: lifespan, metadataRef: 'openrails-mcp' },
  });
  return { link, recipient, amount, type: oneTime ? 'one-time' : 'streaming' };
}

// ---- issue_railscard --------------------------------------------------------
export async function issueRailscard(
  ctx: OpenRailsContext,
  args: { amount: string; mode?: 'bearer' | 'recipient_bound'; recipient?: string; oneTime?: boolean; velocityPerSecond?: string; lifespanSeconds?: number },
) {
  const account = await ctx.requireAccount();
  const client = await ctx.requireClient();
  const payer = await account.getAddress();
  const bearer = (args.mode ?? 'bearer') === 'bearer';
  const recipient = bearer ? ethers.ZeroAddress : ethers.getAddress(args.recipient ?? ethers.ZeroAddress);
  if (!bearer && recipient === ethers.ZeroAddress) throw new Error('recipient_bound cards need a recipient');
  const amount = positiveBaseUnits(args.amount, 'amount');
  const oneTime = args.oneTime ?? true;
  const { velocity, lifespan } = paymentTiming({ ...args, oneTime });
  const { hubAddress: hub, usdcAddress: token, chainId, appBaseUrl } = ctx.config;
  const mode = bearer ? 'railscard_bearer' : 'railscard_recipient_bound';

  const metadata = metadataFor({ mode, originator: payer, recipient, token, amount, velocity, lifespan });
  const metadataHash = hashOpenRailsMetadata(metadata);
  const nonceChannel = randomRailsCardNonceChannel();
  const nonceValue = Number(await readNonce(asProvider(ctx), hub, payer, nonceChannel));
  const paycardId = buildMetadataBoundPaycardId({ payer, nonceChannel, nonceValue, metadataHash });
  const intent = createRailsCardIntent({
    paycardId, metadataHash,
    totalAllocationPool: amount, flowVelocityPerSecond: velocity,
    genesisTimestamp: Math.floor(Date.now() / 1000), lifespanSeconds: lifespan,
    residualDeltaRecipient: payer, nonceChannel, nonceValue,
  });
  if (!bearer) intent.recipient = recipient;

  const reservation = await reserveRailsCardAllowance(account, asProvider(ctx), token, hub, amount);
  const envelopeToken = await client.signPermissionEnvelope(intent, { mode, metadata });
  const link = createRailsCardClaimLink({ appBaseUrl, chainId, vault: hub, token, metadataHash, mode, envelopeToken });
  return {
    link, paycardId, mode, amount, type: oneTime ? 'one-time' : 'streaming',
    authorizationTxHash: reservation.transactionHash ?? null,
    note: 'Hub allowance was reserved at issuance. Escrow is pulled from the payer on claim, subject to the payer balance.',
  };
}

// ---- paycard_status ---------------------------------------------------------
export async function paycardStatus(ctx: OpenRailsContext, args: { paycardId: string }) {
  const c = await readPaycard(asProvider(ctx), ctx.config.hubAddress, args.paycardId);
  return {
    paycardId: args.paycardId,
    payer: c.payer,
    recipient: c.recipient,
    status: c.operationalStatus,
    totalAllocation: ethers.formatUnits(c.totalAllocationPool, 6),
    availableBalance: ethers.formatUnits(c.availableBalance, 6),
    flowVelocityPerSecond: c.flowVelocityPerSecond.toString(),
    lifespanSeconds: Number(c.lifespanSeconds),
    type: Number(c.lifespanSeconds) === 0 ? 'one-time' : 'streaming',
  };
}
