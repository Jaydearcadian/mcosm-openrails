/**
 * Live SDK-path verification: proves the *repointed SDK helpers* open a stream on the
 * deployed V2 canonical hub on Arc (12-arg openPaycardChannel + domain 2.0.0 + explicit payer),
 * then settle and flush — end-to-end through sdk/src/wallet.ts, not raw ethers.
 *
 * Run: npx hardhat run scripts/smoke-v2-sdk.ts --network arcTestnet
 */
import { ethers } from "ethers";
import {
  approveOpenRailsSpend,
  signPermissionEnvelopeWithSigner,
  submitOpenPaycardWithSigner,
  submitSettleWithSigner,
  submitFlushWithSigner,
  readNonce,
} from "../sdk/src/wallet";
import { hashOpenRailsMetadata } from "../sdk/src/metadata";

async function main() {
  const rpc = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.io";
  const provider = new ethers.JsonRpcProvider(rpc);
  const signer = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY as string, provider);
  const chainId = Number((await provider.getNetwork()).chainId);

  const hubAddress = ethers.getAddress(process.env.OPENRAILS_V2_HUB_ADDRESS || "0x941C8029F0f912df3fAb7423890ab2359b996D0b");
  const usdc = ethers.getAddress(process.env.ARC_USDC_ADDRESS || "0x3600000000000000000000000000000000000000");
  const recipient = ethers.getAddress(process.env.OPENRAILS_RECIPIENT_ADDRESS || ethers.Wallet.createRandom().address);
  const recovery = signer.address;
  const explorer = process.env.ARC_EXPLORER_BASE_URL || "https://explorer.testnet.arc.network";
  const link = (h: string) => `${explorer}/tx/${h}`;

  const allocation = "10000"; // 0.01 USDC (over-fund holds: payer balance >> allocation)
  const nonceChannel = 300;
  const nonceValue = await readNonce(provider, hubAddress, signer.address, nonceChannel);
  const latest = await provider.getBlock("latest");

  const metadata = {
    version: "openrails-metadata-v1" as const,
    mode: "railsflow" as const,
    originator: signer.address,
    recipient,
    token: usdc,
    amount: allocation,
    flowVelocityPerSecond: "1",
    lifespanSeconds: 120,
    metadataRef: "v2-sdk-smoke",
  };
  const intent = {
    paycardId: ethers.keccak256(ethers.toUtf8Bytes(`v2-sdk-${Date.now()}`)),
    metadataHash: hashOpenRailsMetadata(metadata),
    recipient,
    totalAllocationPool: allocation,
    flowVelocityPerSecond: "1",
    genesisTimestamp: latest!.timestamp - 10,
    lifespanSeconds: 120,
    residualDeltaRecipient: recovery,
    nonceChannel,
    nonceValue,
  };

  console.log(`SDK-path smoke against V2 hub ${hubAddress} (chainId ${chainId})`);
  console.log(`  payer=${signer.address} recipient=${recipient}`);

  await (await approveOpenRailsSpend(signer, usdc, hubAddress, BigInt(allocation))).wait();

  const token = await signPermissionEnvelopeWithSigner(
    signer,
    { chainId, clearinghouseAddress: hubAddress, usdcAddress: usdc },
    intent,
    { mode: "railsflow", metadata },
  );
  const openTx = await submitOpenPaycardWithSigner(signer, hubAddress, token, "railsflow");
  const openRc = await openTx.wait();
  console.log(`  open  tx: ${link(openTx.hash)} (status ${openRc?.status})`);

  const settleTx = await submitSettleWithSigner(signer, hubAddress, intent.paycardId);
  await settleTx.wait();
  console.log(`  settle tx: ${link(settleTx.hash)}`);

  const flushTx = await submitFlushWithSigner(signer, hubAddress, intent.paycardId);
  await flushTx.wait();
  console.log(`  flush tx: ${link(flushTx.hash)}`);

  console.log(`\n✅ Repointed SDK helpers opened+settled+flushed on the LIVE V2 hub via signPermissionEnvelopeWithSigner + submitOpenPaycardWithSigner (12-arg, domain 2.0.0, explicit payer).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
