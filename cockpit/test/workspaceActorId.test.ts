import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/pages/Cockpit.tsx", import.meta.url);

test("Agent registration exposes and forwards the generated Actor ID", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /if \(actorType === "Agent"\) setDelegateId\(actor\.id\)/);
  assert.match(source, /ACTOR ID \/ \{actor\.id\}/);
});
