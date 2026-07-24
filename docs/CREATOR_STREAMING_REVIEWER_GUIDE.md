# OpenRails Creator Streaming Reviewer Guide

This guide verifies the demo-ready path without granting the demo script access to private keys.

## Stack under review

1. PR #3 — bigint-safe nonce and MCP authorization handling
2. PR #4 — enforceable Goal Session Vault
3. PR #5 — MusicBrainz recording and creator-payee resolution
4. PR #6 — persisted playback lifecycle API
5. PR #7 — reproducible creator-streaming demo
6. This PR — idempotency hardening and reviewer evidence

## Required environment

```bash
export OPENRAILS_MUSIC_WORKER_URL=https://<worker-host>
export OPENRAILS_WEBHOOK_SECRET=<worker-secret>
export OPENRAILS_LISTENER_ADDRESS=0x...
export OPENRAILS_ARTIST_MBID=<registered-artist-mbid>
export OPENRAILS_BUDGET_BASE_UNITS=5000000
export OPENRAILS_VELOCITY_BASE_UNITS=1000
```

For the non-custodial path, also provide a listener-signed envelope:

```bash
export OPENRAILS_ENVELOPE_TOKEN=<base64url-envelope>
```

Run:

```bash
npm run demo:creator-stream
```

## Expected positive evidence

The output must contain:

- one session identifier;
- one payment-channel or paycard identifier;
- the creator MBID and verified payout wallet;
- an `active` session after open;
- no additional accrual when the same heartbeat timestamp is replayed;
- increasing accrual for a later timestamp;
- a final `stopped` state;
- the same state when stop is replayed;
- accrued value capped by the configured session budget.

## Required negative checks

### Authentication

Call a mutating route without `X-OpenRails-Webhook-Secret` and confirm HTTP 401.

### Session-id policy collision

Open a session, then repeat `/session/open` with the same `sessionId` but a different listener, creator, budget, or velocity. Confirm HTTP 409 with `code: conflict`.

### Unknown session

Heartbeat or stop an unknown session identifier. Confirm HTTP 404.

### Out-of-order heartbeat

Submit an earlier or equal heartbeat timestamp. Confirm the request succeeds idempotently and does not reduce or double-count accrued value.

### Post-stop mutation

Replay heartbeat and stop calls after the session has stopped. Confirm no additional value is accrued.

### Budget cap

Advance the heartbeat beyond the funded duration. Confirm `accruedBaseUnits` never exceeds `budgetBaseUnits`.

## Onchain evidence

Capture and retain:

- transaction hash returned by `/session/open`;
- Hub address and chain ID;
- payer or Goal Session Vault address;
- recipient wallet;
- total allocation and velocity;
- nonce channel and value when available;
- final transaction receipt status.

The offchain lifecycle receipt must never be presented as a substitute for the onchain settlement receipt. It is the application state and accrual record linked to the payment identifier.

## Security boundaries

- The deterministic payment and lifecycle state is authoritative.
- MusicBrainz supplies identity metadata, not payout authority.
- Creator payout authority comes from the independently verified wallet registration.
- AI-generated explanation must not authorize, alter, or upgrade settlement state.
- The relayer-funded path is demo-only; production claims require the listener-signed envelope path.
- Session IDs are idempotency keys bound to the original listener, creator, budget, and velocity policy.

## Current release blocker

Do not promote this stack to production until GitHub-hosted checks execute successfully and the temporary Actions startup waivers are removed.
