import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("../src/lib/newPayment.ts", import.meta.url);

test("useNewPayment exposes a stable reset callback across rerenders", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /const reset = useCallback\(\(\) => \{\s*setStatus\(\{ id: "idle" \}\);\s*\}, \[\]\);/);
  assert.doesNotMatch(source, /function reset\(\)/);
});
