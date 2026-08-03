import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContext } from '../dist/context.js';
import {
  SAFE_MCP_TOOL_NAMES,
  openrailsCapabilities,
  prepareOperation,
  validateOperation,
} from '../dist/tools.js';

const ctx = buildContext();

test('safe MCP capabilities do not include signer or broadcast authority', async () => {
  const result = await openrailsCapabilities(ctx);
  assert.equal(result.safeSurface.canSign, false);
  assert.equal(result.safeSurface.createsSigners, false);
  assert.equal(result.safeSurface.canBroadcast, false);
  assert.equal(result.safeSurface.canRelay, false);
  assert.equal(result.canonicalRecords.policy, 'pact-declared-and-optional');
  assert.deepEqual(SAFE_MCP_TOOL_NAMES, [
    'openrails_capabilities',
    'openrails_prepare',
    'openrails_validate',
    'openrails_verify',
    'openrails_read',
  ]);
});

test('prepare creates a valid envelope without authorization or broadcast', async () => {
  const result = await prepareOperation(ctx, { operationId: 'network.get', data: { networkId: 'arc-testnet' } });
  assert.equal(result.valid, true);
  assert.equal(result.signed, false);
  assert.equal(result.broadcasted, false);
  assert.equal(result.request.operationId, 'network.get');
});

test('custody fields are rejected before preparation', async () => {
  await assert.rejects(
    prepareOperation(ctx, {
      operationId: 'network.list',
      data: { privateKey: 'not accepted' },
    }),
    /safe-only MCP surface/,
  );
});

test('validation is descriptive and has no transaction side effect', async () => {
  const result = await validateOperation(ctx, {
    operationId: 'network.list',
    envelope: {},
  });
  assert.equal(result.valid, false);
  assert.equal(result.broadcasted, false);
  assert.ok(result.issues.length > 0);
});
