import { expect } from "chai";
import {
  CircleIntegrationUnavailableError,
  CircleWalletManager,
  KeylessSignatureForwarder,
} from "../server/circle";

describe("legacy Circle server boundary", () => {
  it("fails closed for every synthetic wallet and signing operation", async () => {
    const manager = new CircleWalletManager();
    const forwarder = new KeylessSignatureForwarder();

    await expect(manager.initialize("")).to.be.rejectedWith(CircleIntegrationUnavailableError);
    await expect(manager.createWallet("user-under-test")).to.be.rejectedWith(CircleIntegrationUnavailableError);
    await expect(manager.getWalletBalance("wallet-under-test")).to.be.rejectedWith(CircleIntegrationUnavailableError);
    await expect(forwarder.forwardForSigning("0x00", "wallet-under-test")).to.be.rejectedWith(
      CircleIntegrationUnavailableError,
    );
  });
});
