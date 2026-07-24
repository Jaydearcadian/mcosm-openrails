#!/usr/bin/env node

const baseUrl = process.env.OPENRAILS_MUSIC_WORKER_URL;
const secret = process.env.OPENRAILS_WEBHOOK_SECRET;
const listenerAddress = process.env.OPENRAILS_LISTENER_ADDRESS;
const artistMbid = process.env.OPENRAILS_ARTIST_MBID;
const sessionId = process.env.OPENRAILS_SESSION_ID ?? `demo-${Date.now()}`;

if (!baseUrl || !secret || !listenerAddress || !artistMbid) {
  console.error(
    "Missing required env: OPENRAILS_MUSIC_WORKER_URL, OPENRAILS_WEBHOOK_SECRET, OPENRAILS_LISTENER_ADDRESS, OPENRAILS_ARTIST_MBID",
  );
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  "x-openrails-webhook-secret": secret,
};

async function call(path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`);
  }
  return body;
}

function print(label, value) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify(value, null, 2));
}

const now = Math.floor(Date.now() / 1000);
const open = await call("/session/open", {
  method: "POST",
  body: JSON.stringify({
    sessionId,
    listenerAddress,
    artistMbid,
    budgetUsdc: process.env.OPENRAILS_BUDGET_BASE_UNITS ?? "5000000",
    velocityPerSecond: process.env.OPENRAILS_VELOCITY_BASE_UNITS ?? "1000",
    lifespanSeconds: process.env.OPENRAILS_LIFESPAN_SECONDS ?? "3600",
    envelopeToken: process.env.OPENRAILS_ENVELOPE_TOKEN,
  }),
});
print("OPEN", open);

const heartbeat1 = await call(`/session/${encodeURIComponent(sessionId)}/heartbeat`, {
  method: "POST",
  body: JSON.stringify({ timestamp: now + 30 }),
});
print("HEARTBEAT +30s", heartbeat1);

const heartbeatReplay = await call(`/session/${encodeURIComponent(sessionId)}/heartbeat`, {
  method: "POST",
  body: JSON.stringify({ timestamp: now + 30 }),
});
print("IDEMPOTENT HEARTBEAT REPLAY", heartbeatReplay);

const heartbeat2 = await call(`/session/${encodeURIComponent(sessionId)}/heartbeat`, {
  method: "POST",
  body: JSON.stringify({ timestamp: now + 75 }),
});
print("HEARTBEAT +75s", heartbeat2);

const stopped = await call(`/session/${encodeURIComponent(sessionId)}/stop`, {
  method: "POST",
  body: JSON.stringify({ timestamp: now + 90 }),
});
print("STOP", stopped);

const stoppedReplay = await call(`/session/${encodeURIComponent(sessionId)}/stop`, {
  method: "POST",
  body: JSON.stringify({ timestamp: now + 90 }),
});
print("IDEMPOTENT STOP REPLAY", stoppedReplay);

const receipt = await call(`/session/${encodeURIComponent(sessionId)}`);
print("FINAL RECEIPT", receipt);

const session = receipt.session;
const expectedMinimum = BigInt(process.env.OPENRAILS_VELOCITY_BASE_UNITS ?? "1000") * 90n;
if (BigInt(session.accruedBaseUnits) < expectedMinimum) {
  throw new Error(`Unexpected accrued amount: ${session.accruedBaseUnits} < ${expectedMinimum}`);
}
if (session.status !== "stopped") {
  throw new Error(`Unexpected final status: ${session.status}`);
}

console.log(`\nDemo complete for session ${sessionId}`);
console.log(`Paycard: ${session.paycardId}`);
console.log(`Accrued base units: ${session.accruedBaseUnits}`);
