import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/pages/Cockpit.tsx", import.meta.url);
const runtimeSourceUrl = new URL("../src/lib/workspaceRuntime.ts", import.meta.url);

test("Participant registration exposes and forwards the generated participant ID", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /if \(actor\.walletAddress\) setDelegateId\(actor\.id\)/);
  assert.match(source, /PARTICIPANT ID \/ \{actor\.id\}/);
  assert.match(source, /Choose a wallet-bound participant/);
});

test("Pact preparation separates Workspace owner and active participant signers", async () => {
  const source = await readFile(runtimeSourceUrl, "utf8");

  assert.match(source, /ownerHandle: RuntimeAccountHandle/);
  assert.match(source, /delegateHandle: RuntimeAccountHandle = ownerHandle/);
  assert.match(source, /runtime\.execute\("intent\.prepare", \{ intent \}, ownerHandle\.account/);
  assert.match(source, /runtime\.execute\("proposal\.evaluate", \{ proposal \}, delegateHandle\.account/);
  assert.match(source, /runtime\.execute\("pact\.sign", \{ intentRef, pact \}, delegateHandle\.account/);
});
