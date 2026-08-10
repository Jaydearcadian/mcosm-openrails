export interface RelayPermit {
  owner: string;
  spender: string;
  value: string;
  deadline: number;
  v: number;
  r: string;
  s: string;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

export function validateRelayPermit(
  permit: RelayPermit,
  payer: string,
  hubAddress: string,
  allocation: bigint,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  try {
    if (!ADDRESS_RE.test(permit.owner) || permit.owner.toLowerCase() !== payer.toLowerCase()) {
      return "Permit owner does not match the signed payer";
    }
    if (!ADDRESS_RE.test(permit.spender) || permit.spender.toLowerCase() !== hubAddress.toLowerCase()) {
      return "Permit spender does not match the OpenRails Hub";
    }
    if (BigInt(permit.value) < allocation) {
      return "Permit value is below the signed allocation";
    }
    if (!Number.isSafeInteger(permit.deadline) || permit.deadline <= nowSeconds) {
      return "Permit is expired or has an invalid deadline";
    }
  } catch {
    return "Permit contains invalid authorization values";
  }
  return null;
}
