import assert from "node:assert/strict";
import test from "node:test";
import {
  UINT256_MAX,
  evaluateRailsCardFunding,
  nextRailsCardAllowance,
  railsCardNonceChannelFromWords,
} from "../src/lib/railsCardFunding.ts";

const PAYER = "0x00000000000000000000000000000000000000AA";
const HUB = "0x00000000000000000000000000000000000000BB";

test("adds each new card allocation to the remaining allowance", () => {
  assert.equal(nextRailsCardAllowance(2_000_000n, 3_000_000n), 5_000_000n);
  assert.equal(nextRailsCardAllowance(UINT256_MAX, 1n), UINT256_MAX);
});

test("builds independent nonce channels that remain exactly serializable", () => {
  assert.equal(railsCardNonceChannelFromWords(0, 0), 1n);
  assert.equal(railsCardNonceChannelFromWords(1, 2), (1n << 32n) | 2n);
  assert.equal(
    railsCardNonceChannelFromWords(0xffffffff, 0xffffffff),
    BigInt(Number.MAX_SAFE_INTEGER),
  );
});

test("accepts current allowance without requiring a permit", () => {
  assert.deepEqual(
    evaluateRailsCardFunding({
      expectedNonce: 4n,
      currentNonce: 4n,
      balance: 10_000_000n,
      allowance: 5_000_000n,
      allocation: 5_000_000n,
      payer: PAYER,
      hub: HUB,
      nowSeconds: 100,
    }),
    { ok: true, needsPermit: false },
  );
});

test("ignores an expired legacy permit when current allowance covers the card", () => {
  assert.deepEqual(
    evaluateRailsCardFunding({
      expectedNonce: 4n,
      currentNonce: 4n,
      balance: 10_000_000n,
      allowance: 5_000_000n,
      allocation: 5_000_000n,
      payer: PAYER,
      hub: HUB,
      nowSeconds: 101,
      permit: { owner: PAYER, spender: HUB, value: "5000000", deadline: 100 },
    }),
    { ok: true, needsPermit: false },
  );
});

test("rejects an expired legacy permit when allowance is insufficient", () => {
  const result = evaluateRailsCardFunding({
    expectedNonce: 4n,
    currentNonce: 4n,
    balance: 10_000_000n,
    allowance: 0n,
    allocation: 5_000_000n,
    payer: PAYER,
    hub: HUB,
    nowSeconds: 101,
    permit: { owner: PAYER, spender: HUB, value: "5000000", deadline: 100 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "expired");
});

test("rejects malformed legacy permit values", () => {
  const result = evaluateRailsCardFunding({
    expectedNonce: 4n,
    currentNonce: 4n,
    balance: 10_000_000n,
    allowance: 0n,
    allocation: 5_000_000n,
    payer: PAYER,
    hub: HUB,
    permit: { owner: PAYER, spender: HUB, value: "invalid", deadline: 200 },
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "authorization");
});

test("rejects stale intent nonces before attempting a transaction", () => {
  const result = evaluateRailsCardFunding({
    expectedNonce: 3n,
    currentNonce: 4n,
    balance: 10_000_000n,
    allowance: 5_000_000n,
    allocation: 5_000_000n,
    payer: PAYER,
    hub: HUB,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "stale");
});
