import { fallback, http } from "viem";
import { ARC_RPC_URLS } from "./chain";

export function createArcTransport() {
  return fallback(
    ARC_RPC_URLS.map((url) =>
      http(url, {
        retryCount: 0,
        timeout: 8_000,
      }),
    ),
    {
      rank: false,
      retryCount: 1,
      retryDelay: 300,
    },
  );
}
