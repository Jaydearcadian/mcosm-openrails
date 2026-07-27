import { expect } from "chai";
import { ethers } from "hardhat";
import { LeptonOpenRailsClient, type OpenRailsIntentV1 } from "../sdk/src/client";
import { deserializeEnvelope, serializeEnvelope } from "../cockpit/src/lib/intents";
import {
  RAILSCARD_NONCE_CHANNEL_BYTES,
  nonceChannelFromBytes,
} from "../cockpit/src/lib/nonceLane";

describe("RailsCard nonce lanes", () => {
  it("builds non-zero uint128 channels and preserves them through JSON envelopes", () => {
    const bytes = new Uint8Array(RAILSCARD_NONCE_CHANNEL_BYTES);
    bytes[0] = 0x80;
    bytes[RAILSCARD_NONCE_CHANNEL_BYTES - 1] = 0x2a;

    const channel = nonceChannelFromBytes(bytes);
    expect(channel).to.equal((1n << 127n) + 42n);

    const token = serializeEnvelope({ intent: { nonceChannel: channel.toString(), nonceValue: "0" } });
    const decoded = deserializeEnvelope<{ intent: { nonceChannel: string; nonceValue: string } }>(token);
    expect(BigInt(decoded.intent.nonceChannel)).to.equal(channel);
    expect(BigInt(decoded.intent.nonceValue)).to.equal(0n);

    expect(nonceChannelFromBytes(new Uint8Array(RAILSCARD_NONCE_CHANNEL_BYTES))).to.equal(1n);
    expect(() => nonceChannelFromBytes(new Uint8Array(8))).to.throw(
      `RailsCard nonce channels require ${RAILSCARD_NONCE_CHANNEL_BYTES} random bytes.`,
    );
  });

  async function deployFixture() {
    const [deployer, relayer, recipientA, recipientB, recoveryVault] = await ethers.getSigners();
    const network = await ethers.provider.getNetwork();

    const Token = await ethers.getContractFactory("MockUSDC");
    const token = await Token.deploy();
    await token.waitForDeployment();

    const Hub = await ethers.getContractFactory("ArcOpenRailsHubV1");
    const hub = await Hub.deploy(await token.getAddress());
    await hub.waitForDeployment();

    const payerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
    await deployer.sendTransaction({ to: payerWallet.address, value: ethers.parseEther("1") });
    await token.mint(payerWallet.address, ethers.parseUnits("1000", 6));
    await token.connect(payerWallet).approve(await hub.getAddress(), ethers.parseUnits("1000", 6));

    const client = new LeptonOpenRailsClient(
      payerWallet.privateKey,
      await hub.getAddress(),
      Number(network.chainId),
      undefined,
      10_000_000,
      "1.0.0",
    );

    const latestBlock = await ethers.provider.getBlock("latest");
    const genesisTimestamp = Number(latestBlock!.timestamp) - 1;

    function intent(label: string, nonceChannel: number, recipient: string): OpenRailsIntentV1 {
      return {
        paycardId: ethers.keccak256(ethers.toUtf8Bytes(`railscard-${label}`)),
        metadataHash: ethers.keccak256(ethers.toUtf8Bytes(`metadata-${label}`)),
        recipient,
        totalAllocationPool: ethers.parseUnits("10", 6).toString(),
        flowVelocityPerSecond: ethers.parseUnits("0.01", 6).toString(),
        genesisTimestamp,
        lifespanSeconds: 10_000,
        residualDeltaRecipient: recoveryVault.address,
        nonceChannel,
        nonceValue: 0,
      };
    }

    async function sign(value: OpenRailsIntentV1) {
      return LeptonOpenRailsClient.deserializePayload(await client.signPermissionEnvelope(value));
    }

    async function openFixed(envelope: Awaited<ReturnType<typeof sign>>) {
      const i = envelope.intent;
      return hub.connect(relayer).openPaycardChannel(
        i.paycardId,
        i.metadataHash,
        i.recipient,
        i.totalAllocationPool,
        i.flowVelocityPerSecond,
        i.genesisTimestamp,
        i.lifespanSeconds,
        i.residualDeltaRecipient,
        envelope.envelopeSignature,
        i.nonceChannel,
        i.nonceValue,
      );
    }

    async function claimBearer(
      envelope: Awaited<ReturnType<typeof sign>>,
      claimRecipient: string,
    ) {
      const i = envelope.intent;
      return hub.connect(relayer).claimWildcardPaycardChannel(
        i.paycardId,
        i.metadataHash,
        claimRecipient,
        i.totalAllocationPool,
        i.flowVelocityPerSecond,
        i.genesisTimestamp,
        i.lifespanSeconds,
        i.residualDeltaRecipient,
        envelope.envelopeSignature,
        i.nonceChannel,
        i.nonceValue,
      );
    }

    return {
      hub,
      payerWallet,
      recipientA,
      recipientB,
      intent,
      sign,
      openFixed,
      claimBearer,
    };
  }

  it("redeems two pre-signed recipient-bound cards in reverse order", async () => {
    const { hub, payerWallet, recipientA, recipientB, intent, sign, openFixed } = await deployFixture();
    const channelA = 41_001;
    const channelB = 41_002;

    const intentA = intent("bound-a", channelA, recipientA.address);
    const intentB = intent("bound-b", channelB, recipientB.address);
    const envelopeA = await sign(intentA);
    const envelopeB = await sign(intentB);

    await expect(openFixed(envelopeB)).to.emit(hub, "PaycardProvisioned");
    await expect(openFixed(envelopeA)).to.emit(hub, "PaycardProvisioned");

    expect((await hub.registry(intentA.paycardId)).recipient).to.equal(recipientA.address);
    expect((await hub.registry(intentB.paycardId)).recipient).to.equal(recipientB.address);
    expect(await hub.accountNonceTracks(payerWallet.address, channelA)).to.equal(1n);
    expect(await hub.accountNonceTracks(payerWallet.address, channelB)).to.equal(1n);

    const replay = await sign(intent("bound-replay", channelA, recipientA.address));
    await expect(openFixed(replay)).to.be.revertedWith("Nonce: invalid nonce");
  });

  it("redeems two pre-signed bearer cards in reverse order", async () => {
    const { hub, payerWallet, recipientA, recipientB, intent, sign, claimBearer } = await deployFixture();
    const channelA = 51_001;
    const channelB = 51_002;

    const intentA = intent("bearer-a", channelA, ethers.ZeroAddress);
    const intentB = intent("bearer-b", channelB, ethers.ZeroAddress);
    const envelopeA = await sign(intentA);
    const envelopeB = await sign(intentB);

    await expect(claimBearer(envelopeB, recipientB.address)).to.emit(hub, "PaycardProvisioned");
    await expect(claimBearer(envelopeA, recipientA.address)).to.emit(hub, "PaycardProvisioned");

    expect((await hub.registry(intentA.paycardId)).recipient).to.equal(recipientA.address);
    expect((await hub.registry(intentB.paycardId)).recipient).to.equal(recipientB.address);
    expect(await hub.accountNonceTracks(payerWallet.address, channelA)).to.equal(1n);
    expect(await hub.accountNonceTracks(payerWallet.address, channelB)).to.equal(1n);
  });
});
