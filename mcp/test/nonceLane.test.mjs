import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateUnusedRailsCardLane } from '../dist/nonceLane.js';

const base = {
  provider: {},
  hubAddress: '0x0000000000000000000000000000000000000001',
  payer: '0x0000000000000000000000000000000000000002',
};

test('allocates a non-zero unused safe nonce lane', async () => {
  const result = await allocateUnusedRailsCardLane({
    ...base,
    randomBytes: () => Uint8Array.from([0, 0, 0, 0, 0, 7]),
    readNonceFn: async (_provider, _hub, _payer, channel) => {
      assert.equal(channel, 7);
      return 0;
    },
  });

  assert.deepEqual(result, { nonceChannel: 7, nonceValue: 0 });
});

test('skips channel zero and occupied lanes', async () => {
  const candidates = [
    Uint8Array.from([0, 0, 0, 0, 0, 0]),
    Uint8Array.from([0, 0, 0, 0, 0, 9]),
    Uint8Array.from([0, 0, 0, 0, 0, 10]),
  ];
  let index = 0;

  const result = await allocateUnusedRailsCardLane({
    ...base,
    randomBytes: () => candidates[index++],
    readNonceFn: async (_provider, _hub, _payer, channel) => channel === 9 ? 1 : 0,
  });

  assert.deepEqual(result, { nonceChannel: 10, nonceValue: 0 });
});

test('fails closed when no unused lane can be found', async () => {
  await assert.rejects(
    allocateUnusedRailsCardLane({
      ...base,
      attempts: 2,
      randomBytes: () => Uint8Array.from([0, 0, 0, 0, 0, 11]),
      readNonceFn: async () => 1,
    }),
    /Could not allocate an unused RailsCard nonce lane/,
  );
});
