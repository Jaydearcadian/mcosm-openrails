# OpenRails Unified Interface Implementation Handoff

**Version:** 1.0.0
**Status:** PR1 typed implementation schema package implemented and validated; downstream migration pending
**Operation:** OP-AGENT-91cbd9202193
**Target repository:** `Jaydearcadian/mcosm-OpenRails`
**Frontend source:** `cooke-dev/mcosm-OpenRails` at `d85a9d28b815765f104f33470250cffd7dc4d502`
**Target baseline:** `feature/workspace-updates` at `e153dca6d46a8531c3ad45aad5906dbf0a2088ed`

## PR1 Typed Package

The private canonical package is `interface/` in the target repository: `@openrails/shared-interface@0.1.0`, schema version `1.0.1`, with JSON Schema 2020-12 as the portable contract and deterministic generated TypeScript at `interface/src/generated.ts`. Its operation registry covers all 38 capabilities in `shared-interface.yaml`, `interface/src/operations.ts` validates each wrapper against its registry-selected exact payload schema, and its Arc Testnet manifest keeps Workspace Runtime explicitly `NOT_LIVE`.

Validation evidence: `npm install`, `npm run schemas:validate`, `npm run generate:check`, `npm test`, `npm run typecheck`, `npm run build`, and `npm run pack:check` passed in `interface/`. The initial sandbox-only pack attempt failed on a read-only npm cache and the approved host-cache rerun passed. Tests cover bytes32 Paycard IDs, zero-start replay nonces, nonzero semantic addresses, single-source signed and recipient fields, transaction-owned receipt identity, V2 event mappings, typed references, and exact operation validation. The pack smoke imports the built API with packaged AJV dependencies.

PR1 does not integrate or claim completion for SDK, MCP, REST, Runtime, worker, web, frontend, GIWA, X Layer, MidiumOR, GoalSession, or sidecar consumers.

## Protected Direction

- The Jayde repository is the unified implementation, release, SDK, MCP, and Cloudflare Pages target.
- The Cooke repository supplies brand, design tokens, information architecture, selected web components, and GIWA implementation source material.
- Arc remains the lead narrative and default network in the target.
- Arc, GIWA, and X Layer retain authority over their own deployment truth.
- GoalSession remains a separate agent integration primitive. It is not Workspace or Path.
- The wallet remains the authorization boundary, and each network Vault remains canonical financial state.
- Arc anchoring is downstream and is not required for this migration.

## Architecture Decision

Keep `cockpit/` as the single deployable Cloudflare Pages application. Absorb the Cooke visual system and information architecture into that application in reviewable slices. Do not copy `apps/gasok-web` as a second runtime.

This preserves the target's Privy and wagmi provider, Arc RPC fallback, permit and typed-data handling, RailsFlow and RailsCard paths, indexer integration, and existing Pages deployment. It also keeps rollback to the current landing and cockpit routes small.

Frontend implementation does not start from the current semantic YAML alone. The interface owner must first produce typed object schemas, identifiers, constraints, transition rules, conditional profile requirements, per-operation request and response contracts, authorization mappings, receipt schemas, structured errors, and an Arc capability manifest.

```text
cockpit/
|-- unified narrative shell
|   |-- /             OpenRails on Arc
|   |-- /system       shared lifecycle and verticals
|   |-- /workspaces   ownership, actors, Paths, Pacts, Proof, Gaia
|   |-- /network      Arc default plus honest peer capability status
|   |-- /build        SDK, MCP, REST, adapters, integrations
|   `-- /docs         operating and technical documentation
|-- operational surface
|   |-- /rails        canonical rail operations route
|   `-- /cockpit      compatibility and rollback route
`-- payment entrypoints
    |-- /openrails/flow
    `-- /openrails/card
```

## Contract-First Precondition

PR1 covers the typed package portion of the contract-first precondition. The remaining migration plan must cover:

- consumer adoption of the versioned schema package under the accepted target path;
- direct wallet-authorized and delegated Runtime profile constraints;
- Proof policies for `NONE`, `AUTHORIZATION`, `CLAIM`, `CHECKPOINT`, and `FINAL_SETTLEMENT`;
- typed Arc capability and network manifests;
- SDK types and validation boundaries;
- MCP and REST operation mappings;
- successful, blocked, reverted, expired, wrong-network, and RPC-unavailable fixtures;
- schema and conformance commands discovered from the target repository or explicitly approved with any new dependency.

The exact schema paths and runtime validation dependency are now implemented under `interface/`; this handoff does not authorize consumer migration. Downstream owners must adopt the package through their own reviewed integration plans.

## Frontend File Proposal

No frontend file is approved for editing until the contract-first precondition is implemented, validated, and accepted.

### Add

- `packages/openrails-design-system/package.json`
- `packages/openrails-design-system/tokens.css`
- `packages/openrails-design-system/README.md`
- `cockpit/src/components/unified/UnifiedShell.tsx`
- `cockpit/src/components/unified/Footer.tsx`
- `cockpit/src/components/unified/SystemMap.tsx`
- `cockpit/src/components/unified/RuntimeArchitecture.tsx`
- `cockpit/src/pages/UnifiedHome.tsx`
- `cockpit/src/pages/System.tsx`
- `cockpit/src/pages/Workspaces.tsx`
- `cockpit/src/pages/Network.tsx`
- `cockpit/src/pages/Build.tsx`
- `cockpit/src/styles/unified.css`
- focused route and browser tests under the existing `cockpit/test/` area

### Modify

- `cockpit/src/App.tsx`
- `cockpit/package.json`
- `cockpit/package-lock.json`
- `cockpit/public/_redirects` only if direct-navigation coverage proves the current fallback insufficient

### Preserve In The First Slice

- `cockpit/src/components/Providers.tsx`
- `cockpit/src/components/ConnectWalletButton.tsx`
- `cockpit/src/lib/chain.ts`
- `cockpit/src/lib/rpc.ts`
- `cockpit/src/lib/wagmi-config.ts`
- `cockpit/src/lib/useWalletConnection.ts`
- `cockpit/src/lib/newPayment.ts`
- `cockpit/src/lib/useRailsActions.ts`
- `cockpit/src/lib/permit.ts`
- `cockpit/src/lib/intents.ts`
- `cockpit/src/lib/links.ts`
- `cockpit/src/lib/railsCardFunding.ts`
- `cockpit/src/pages/LinkLanding.tsx`
- current modal, stream, receipt, explorer, faucet, indexer, worker, and settlement behavior

These files may be tested but are outside the first implementation write set. Any required change must be reported as a scope expansion before editing.

## Source Adoption Rules

Adopt from Cooke:

- `packages/openrails-design-system` tokens and package structure;
- navigation hierarchy, compact header behavior, route reset, footer, and narrative composition;
- visual structures from `NarrativeHome`, `SystemMap`, `SystemNarrativeIntro`, `RuntimeArchitecture`, and `DocsDiagram`;
- Paycard progress, inspector, and receipt presentation in a later operational reskin.

Do not import directly:

- `apps/gasok-web/src/lib/wallet.tsx`;
- `apps/gasok-web/src/lib/openrails.ts`;
- `apps/gasok-web/src/data/giwa.ts` or `data/network.ts`;
- the GIWA-specific `NetworkRoute` transaction and faucet implementation;
- `LiveVerticalSlice`, `RecordedRunView`, or recorded GIWA data as live Arc evidence;
- `apps/gasok-web/server/index.mjs` or its Node and `agent-kernel` runtime dependency;
- Cooke's global stylesheet without scoping and collision review.

## Implementation Sequence

1. Snapshot the current target status and separate the existing Arc RPC, permit, QR, and recipient-bound RailsCard changes from the interface migration.
2. Produce and validate the typed implementation schema package, operation contracts, transition rules, receipts, errors, and Arc capability manifest.
3. Migrate SDK, MCP, and REST boundaries to those contracts and record the Arc conformance fixtures required for launch.
4. Add GIWA and X Layer manifests with honest `UNAVAILABLE` statuses where behavior is not conformant.
5. Add the design-system package and scoped unified styles without changing the current route output.
6. Add the unified shell and narrative routes behind the existing root provider.
7. Keep `/cockpit`, `/openrails/flow`, and `/openrails/card` behavior unchanged and add `/rails` as the canonical operational entry.
8. Add `/workspaces` only as a Shared Interface projection backed by declared capability status. Do not imply unimplemented Arc Runtime behavior.
9. Replace `/` with `UnifiedHome` after unit, route, accessibility, responsive, and browser checks pass.
10. Reskin operational components in separate slices after Arc transaction parity is recorded.
11. Promote the unified Pages deployment only after all Arc-led Shared Interface 1.0 launch gates and rollback checks pass.

## Acceptance Criteria

- The first viewport leads with OpenRails on Arc and intent-driven clearing and settlement for streamed and one-time work.
- Workspace, Path, Pact, Proof, and Gaia extend the Arc rail into authority and accountability without replacing its foundation.
- `/`, `/system`, `/workspaces`, `/rails`, `/network`, `/build`, `/docs`, `/cockpit`, `/openrails/flow`, and `/openrails/card` survive direct navigation.
- Privy remains the wallet integration, including connect, disconnect, and wrong-network recovery.
- RailsFlow, bearer RailsCard, and recipient-bound RailsCard retain sponsored and own-gas paths.
- Signature, permit expiry, loading, submission, confirmation, revert, replacement, dropped, and RPC failure states remain visible and recoverable.
- Managed Arc RPC and public fallback behavior remain intact.
- GIWA and X Layer status is capability-driven and does not claim false live parity.
- GoalSession appears only as an agent integration surface.
- Mobile, tablet, desktop, keyboard, focus, reduced-motion, and text-overflow checks pass.
- Typed schemas, SDK, MCP, REST, capability-manifest, cockpit, browser, security, and Arc transaction checks pass before Pages promotion.

## Rollout And Rollback

Roll out through a preview Pages deployment before promoting the main branch. Keep `Landing.tsx` and `/cockpit` intact until the unified root has passed browser and transaction checks.

Rollback is:

1. route `/` back to `Landing`;
2. retain `/cockpit` and payment link routes;
3. redeploy the last verified `cockpit/dist` artifact or last verified commit;
4. do not roll back contracts, addresses, or ABIs as part of a frontend-only release.

## Risks

- Critical: replacing the Jayde provider or transaction layer with GIWA-specific code.
- High: overwriting the existing uncommitted Arc RPC, permit, RailsCard, or QR work.
- High: global CSS collisions from unscoped Cooke styles.
- High: importing a Node server or `agent-kernel` requirement into static Pages delivery.
- Medium: presenting recorded GIWA evidence as live Arc behavior.
- Medium: temporary visual fragmentation before operational views are reskinned.
- Medium: no Cooke frontend test suite was observed, so migration regression coverage must be added in the target.

## Gate Status

- owner-authority: pass
- protected-truth: pass
- evidence-status: pass
- repository-architecture: pass
- semantic-interface-contract: pass
- typed-implementation-schema: pass
- frontend-file-level-scope: proposed
- implementation-approval: pending
- security-review: pending
- application-validation: pending
- integration: pending
- Pages-promotion: blocked until implementation and validation complete
