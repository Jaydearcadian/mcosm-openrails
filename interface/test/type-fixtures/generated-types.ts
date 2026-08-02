import type { ExtensionData } from "../../src/generated.js";

const validExtensionData: ExtensionData = {
  "x-owner": { enabled: true },
  "x-openrails.meta": "fixture"
};

// @ts-expect-error ExtensionData is an object, not a primitive.
const primitiveExtensionData: ExtensionData = "not-an-extension-object";

// @ts-expect-error ExtensionData keys must use the canonical x-* namespace.
const invalidExtensionKey: ExtensionData = { owner: true };

void validExtensionData;
void primitiveExtensionData;
void invalidExtensionKey;
