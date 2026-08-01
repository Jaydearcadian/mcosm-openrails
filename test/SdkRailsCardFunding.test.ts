import { expect } from "chai";
import { ethers } from "hardhat";
import {
  UINT256_MAX,
  nextRailsCardAllowance,
  randomRailsCardNonceChannel,
  reserveRailsCardAllowance,
} from "../sdk/src";
import { ethersToSubmitter } from "../sdk/src/adapters/ethers";

describe("SDK RailsCard funding", function () {
  it("reserves cumulative allowance", function () {
    expect(nextRailsCardAllowance(2_000_000n, 3_000_000n)).to.equal(5_000_000n);
    expect(nextRailsCardAllowance(UINT256_MAX, 1n)).to.equal(UINT256_MAX);
  });

  it("generates non-zero independently usable nonce lanes", function () {
    const channels = Array.from({ length: 32 }, () => randomRailsCardNonceChannel());
    expect(channels.every((channel) => Number.isSafeInteger(channel) && channel > 0)).to.equal(true);
    expect(new Set(channels).size).to.equal(channels.length);
  });

  it("authorizes cumulative allowance through an OpenRails submitter", async function () {
    const [payer, hub] = await ethers.getSigners();
    const token = await (await ethers.getContractFactory("MockUSDC")).deploy();
    await token.waitForDeployment();
    await token.mint(payer.address, 10_000_000n);
    const submitter = ethersToSubmitter(payer);

    const first = await reserveRailsCardAllowance(
      submitter,
      ethers.provider as any,
      await token.getAddress(),
      hub.address,
      3_000_000n,
    );
    const second = await reserveRailsCardAllowance(
      submitter,
      ethers.provider as any,
      await token.getAddress(),
      hub.address,
      4_000_000n,
    );

    expect(first.previousAllowance).to.equal(0n);
    expect(second.previousAllowance).to.equal(3_000_000n);
    expect(await token.allowance(payer.address, hub.address)).to.equal(7_000_000n);
  });
});
