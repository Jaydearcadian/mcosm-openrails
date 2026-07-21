import { expect } from 'chai';
import { ethers } from 'hardhat';

const TYPES = {
  SettlementIntent: [
    { name: 'paycardId', type: 'bytes32' },
    { name: 'metadataHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    { name: 'totalAllocationPool', type: 'uint256' },
    { name: 'flowVelocityPerSecond', type: 'uint256' },
    { name: 'genesisTimestamp', type: 'uint256' },
    { name: 'lifespanSeconds', type: 'uint256' },
    { name: 'residualDeltaRecipient', type: 'address' },
    { name: 'nonceChannel', type: 'uint256' },
    { name: 'nonceValue', type: 'uint256' },
  ],
};

describe('OpenRailsGoalSessionVault', () => {
  it('enforces cumulative allocation and opens a child stream as an EIP-1271 payer', async () => {
    const [owner, agent, creator] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('SessionMockToken')).deploy();
    const hub = await (await ethers.getContractFactory('SessionMockHub')).deploy(await token.getAddress());
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    const vault = await (await ethers.getContractFactory('OpenRailsGoalSessionVault')).deploy(
      owner.address,
      agent.address,
      await token.getAddress(),
      await hub.getAddress(),
      10_000_000n,
      10_000n,
      now + 3600,
      creator.address,
    );

    await token.mint(owner.address, 10_000_000n);
    await token.connect(owner).approve(await vault.getAddress(), 10_000_000n);
    await vault.connect(owner).fund(10_000_000n);

    const intent = {
      paycardId: ethers.keccak256(ethers.toUtf8Bytes('session-child-1')),
      metadataHash: ethers.keccak256(ethers.toUtf8Bytes('music-session-metadata')),
      recipient: creator.address,
      totalAllocationPool: 3_000_000n,
      flowVelocityPerSecond: 1_000n,
      genesisTimestamp: now,
      lifespanSeconds: 3000,
      residualDeltaRecipient: owner.address,
      nonceChannel: (1n << 120n) + 7n,
      nonceValue: 0n,
    };
    const domain = {
      name: 'OpenRails Network',
      version: '2.0.0',
      chainId: Number((await ethers.provider.getNetwork()).chainId),
      verifyingContract: await hub.getAddress(),
    };
    const signature = await agent.signTypedData(domain, TYPES, intent);
    const digest = ethers.TypedDataEncoder.hash(domain, TYPES, intent);

    await vault.connect(agent).reserveIntent(
      digest,
      intent.totalAllocationPool,
      intent.flowVelocityPerSecond,
      intent.recipient,
      signature,
    );
    expect(await vault.committedAllocation()).to.equal(intent.totalAllocationPool);

    await vault.connect(agent).openAuthorized(
      intent.paycardId,
      intent.metadataHash,
      intent.recipient,
      intent.totalAllocationPool,
      intent.flowVelocityPerSecond,
      intent.genesisTimestamp,
      intent.lifespanSeconds,
      intent.nonceChannel,
      intent.nonceValue,
    );

    expect(await hub.payerOf(intent.paycardId)).to.equal(await vault.getAddress());
    expect(await token.balanceOf(await hub.getAddress())).to.equal(intent.totalAllocationPool);
  });

  it('rejects reservations above the session velocity or cumulative budget', async () => {
    const [owner, agent, creator] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory('SessionMockToken')).deploy();
    const hub = await (await ethers.getContractFactory('SessionMockHub')).deploy(await token.getAddress());
    const now = (await ethers.provider.getBlock('latest'))!.timestamp;
    const vault = await (await ethers.getContractFactory('OpenRailsGoalSessionVault')).deploy(
      owner.address, agent.address, await token.getAddress(), await hub.getAddress(), 1_000n, 10n, now + 3600, creator.address,
    );

    const digest = ethers.keccak256(ethers.toUtf8Bytes('policy-test'));
    const signature = await agent.signMessage(ethers.getBytes(digest));
    await expect(vault.connect(agent).reserveIntent(digest, 1001n, 10n, creator.address, signature)).to.be.revertedWithCustomError(vault, 'PolicyViolation');
    await expect(vault.connect(agent).reserveIntent(digest, 100n, 11n, creator.address, signature)).to.be.revertedWithCustomError(vault, 'PolicyViolation');
  });
});
