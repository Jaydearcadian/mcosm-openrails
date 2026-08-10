import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildContext } from '../dist/context.js';
import {
  SAFE_MCP_TOOL_NAMES,
  openrailsCapabilities,
  prepareOperation,
  validateOperation,
} from '../dist/tools.js';

const ctx = buildContext();

function fixture(name) {
  return JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../interface/fixtures/${name}`, import.meta.url)), 'utf8'));
}

test('safe MCP capabilities do not include signer or broadcast authority', async () => {
  const result = await openrailsCapabilities(ctx);
  assert.equal(result.safeSurface.canSign, false);
  assert.equal(result.safeSurface.createsSigners, false);
  assert.equal(result.safeSurface.canBroadcast, false);
  assert.equal(result.safeSurface.canRelay, false);
  assert.equal(result.canonicalRecords.policy, 'pact-declared-and-optional');
  assert.deepEqual(result.runtimeOperations, [
    'workspace.register',
    'actor.register',
    'path.activate',
    'path.revoke',
    'intent.prepare',
    'proposal.evaluate',
    'proposal.submit',
    'pact.sign',
    'proof.submit',
    'proof.verify',
  ]);
  assert.equal(result.runtimeSignature.canRecover, false);
  assert.equal(result.runtimeSignature.canSign, false);
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

test('prepares 1.2 runtime operation shapes from external evidence without signing', async () => {
  const workspace = fixture('workspace-register.json');
  const result = await prepareOperation(ctx, {
    operationId: 'workspace.register',
    data: workspace,
  });
  assert.equal(result.valid, true);
  assert.equal(result.signed, false);
  assert.equal(result.broadcasted, false);
  assert.equal(result.request.interfaceVersion, '1.2.0');
  assert.equal(result.request.executionProfile, 'delegated-runtime');
  assert.equal(result.request.subject.walletAddress, workspace.signatureBinding.signer);
  assert.equal(result.request.data.signatureBinding.operationId, 'workspace.register');
  assert.equal(result.request.createdAt, workspace.signatureBinding.issuedAt);
  assert.deepEqual(result.request.provenance, {
    source: 'configuration',
    authority: 'openrails-sdk',
    evidenceLevel: 'configuration-only',
    observedAt: workspace.signatureBinding.issuedAt,
    notes: 'Derived from signed runtime payload fields. The external signature is present but not verified by createOperationRequest.',
  });
});

test('preserves Pact decisionRef binding while remaining safe-only', async () => {
  const pact = fixture('pact-sign.json');
  const result = await prepareOperation(ctx, {
    operationId: 'pact.sign',
    data: pact,
  });
  assert.equal(result.valid, true);
  assert.deepEqual(result.request.decisionRef, pact.pact.decisionRef);
  assert.equal(result.signed, false);
  assert.equal(result.broadcasted, false);
});

test('rejects actorRef-only and mismatched runtime subjects', async () => {
  const workspace = fixture('workspace-register.json');
  await assert.rejects(
    prepareOperation(ctx, {
      operationId: 'workspace.register',
      data: workspace,
      context: {
        subject: {
          actorRef: { type: 'Actor', id: 'actor:attacker' },
          role: 'owner',
        },
      },
    }),
    /signed runtime context subject must exactly match the SDK-derived value/,
  );
  await assert.rejects(
    prepareOperation(ctx, {
      operationId: 'workspace.register',
      data: workspace,
      context: {
        subject: {
          walletAddress: '0x1111111111111111111111111111111111111111',
          role: 'owner',
        },
      },
    }),
    /signed runtime context subject must exactly match the SDK-derived value/,
  );
});

test('rejects runtime profile, network, and signer-bound reference overrides', async () => {
  const actor = fixture('actor-register.json');
  const attempts = [
    { executionProfile: 'direct-wallet-authorized' },
    { network: { networkId: 'arc-testnet', chainId: '1' } },
    { workspaceRef: { type: 'Workspace', id: 'workspace:attacker' } },
  ];
  for (const context of attempts) {
    await assert.rejects(
      prepareOperation(ctx, {
        operationId: 'actor.register',
        data: actor,
        context,
      }),
      /must exactly match the SDK-derived value/,
    );
  }
});

test('accepts only exact duplicate SDK-derived runtime context', async () => {
  const actor = fixture('actor-register.json');
  const prepared = await prepareOperation(ctx, { operationId: 'actor.register', data: actor });
  const result = await prepareOperation(ctx, {
    operationId: 'actor.register',
    data: actor,
    context: {
      executionProfile: prepared.request.executionProfile,
      subject: prepared.request.subject,
      network: prepared.request.network,
      workspaceRef: prepared.request.workspaceRef,
      provenance: prepared.request.provenance,
      createdAt: prepared.request.createdAt,
    },
  });
  assert.deepEqual(result.request.subject, { walletAddress: actor.signatureBinding.signer, role: 'owner' });
  assert.deepEqual(result.request.workspaceRef, actor.workspaceRef);
  assert.deepEqual(result.request.provenance, prepared.request.provenance);
  assert.equal(result.request.createdAt, actor.signatureBinding.issuedAt);

  await assert.rejects(
    prepareOperation(ctx, {
      operationId: 'actor.register',
      data: actor,
      context: { proofRefs: [{ type: 'Proof', id: 'proof:unsigned' }] },
    }),
    /signed runtime context proofRefs must exactly match the SDK-derived value/,
  );
});

test('rejects caller-controlled runtime provenance and createdAt', async () => {
  const workspace = fixture('workspace-register.json');
  const attempts = [
    {
      provenance: {
        source: 'runtime-evaluation',
        authority: 'caller-controlled',
        evidenceLevel: 'runtime-observed',
        observedAt: workspace.signatureBinding.issuedAt,
      },
    },
    { createdAt: '2026-08-08T12:00:00Z' },
  ];
  for (const context of attempts) {
    await assert.rejects(
      prepareOperation(ctx, {
        operationId: 'workspace.register',
        data: workspace,
        context,
      }),
      /must exactly match the SDK-derived value/,
    );
  }
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
