import { getAddress, Interface } from "ethers";

import {
  hashRuntimeTransition,
  recoverRuntimeTransitionSigner,
  type RuntimeSignatureBinding
} from "@openrails/shared-interface";

import { RuntimeError } from "./errors.js";
import type { ArcReadProvider } from "./provider.js";

export const EIP1271_MAGIC_VALUE = "0x1626ba7e" as const;

const EIP1271_INTERFACE = new Interface([
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)"
]);

function sameAddress(left: string, right: string): boolean {
  return getAddress(left) === getAddress(right);
}

function assertRpcHex(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) {
    throw new RuntimeError("RPC_UNAVAILABLE", `Arc provider returned malformed ${field}.`, {
      retryable: true,
      details: { field, reason: "malformed hexadecimal response" }
    });
  }
  return value;
}

/** Verifies the frozen Shared Interface runtime signature without custody. */
export class ArcRuntimeSignatureVerifier {
  constructor(private readonly provider: ArcReadProvider) {}

  async verify(binding: RuntimeSignatureBinding): Promise<void> {
    let code: string;
    try {
      code = assertRpcHex(await this.provider.getCode(binding.signer), "contract code");
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("RPC_UNAVAILABLE", "Unable to determine whether the runtime signer is a contract account.", {
        retryable: true,
        details: { reason: error instanceof Error ? error.message : "provider failure" }
      });
    }

    if (code === "0x") {
      this.verifyEoa(binding);
      return;
    }

    await this.verifyContract(binding);
  }

  private verifyEoa(binding: RuntimeSignatureBinding): void {
    try {
      const recovered = recoverRuntimeTransitionSigner(binding);
      if (!sameAddress(recovered, binding.signer)) throw new Error("recovered signer differs from binding signer");
    } catch (error) {
      throw new RuntimeError("SIGNATURE_INVALID", "EIP-712 EOA signature is invalid.", {
        details: { reason: error instanceof Error ? error.message : "signature recovery failed" }
      });
    }
  }

  private async verifyContract(binding: RuntimeSignatureBinding): Promise<void> {
    const digest = hashRuntimeTransition(binding);
    let callData: string;
    try {
      callData = EIP1271_INTERFACE.encodeFunctionData("isValidSignature", [digest, binding.signature]);
    } catch (error) {
      throw new RuntimeError("SIGNATURE_INVALID", "The contract signature input cannot be ABI encoded.", {
        details: { reason: error instanceof Error ? error.message : "ABI encoding failed" }
      });
    }

    let result: string;
    try {
      result = assertRpcHex(await this.provider.call({ to: binding.signer, data: callData }), "EIP-1271 return data");
    } catch (error) {
      if (error instanceof RuntimeError) throw error;
      throw new RuntimeError("RPC_UNAVAILABLE", "EIP-1271 verification RPC failed.", {
        retryable: true,
        details: { reason: error instanceof Error ? error.message : "provider failure" }
      });
    }

    try {
      const decoded = EIP1271_INTERFACE.decodeFunctionResult("isValidSignature", result);
      if (typeof decoded[0] !== "string" || decoded[0].toLowerCase() !== EIP1271_MAGIC_VALUE) {
        throw new Error("contract did not return the EIP-1271 magic value");
      }
    } catch (error) {
      throw new RuntimeError("SIGNATURE_INVALID", "The contract signer rejected the EIP-1271 signature.", {
        details: { reason: error instanceof Error ? error.message : "malformed EIP-1271 return data" }
      });
    }
  }
}
