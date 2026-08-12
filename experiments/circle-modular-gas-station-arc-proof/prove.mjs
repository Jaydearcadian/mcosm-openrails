#!/usr/bin/env node

const proofName = "circle-modular-gas-station-arc-proof";

function fail(message) {
  console.error(`[${proofName}] BLOCKED: ${message}`);
  process.exitCode = 2;
}

if (process.env.CIRCLE_MODULAR_LIVE_PROOF !== "1") {
  console.log(`[${proofName}] SKIP: set CIRCLE_MODULAR_LIVE_PROOF=1 to run the interactive proof.`);
  process.exit(0);
}

const required = [
  "VITE_CIRCLE_CLIENT_KEY",
  "VITE_CIRCLE_CLIENT_URL",
  "CIRCLE_PROOF_URL",
  "CIRCLE_PROOF_USERNAME",
  "CIRCLE_PROOF_RECIPIENT",
  "CIRCLE_PROOF_AMOUNT_USDC",
];
const missing = required.filter((name) => !process.env[name]?.trim());
if (missing.length > 0) {
  fail(`missing ${missing.join(", ")}. VITE_CIRCLE_CLIENT_KEY and VITE_CIRCLE_CLIENT_URL must be the public Circle Console browser configuration; the remaining values select the live test. No server credentials belong here.`);
  process.exit(2);
}

let proofUrl;
try {
  proofUrl = new URL(process.env.CIRCLE_PROOF_URL);
  if (proofUrl.protocol !== "http:" && proofUrl.protocol !== "https:") throw new Error("unsupported protocol");
} catch {
  fail("CIRCLE_PROOF_URL must be an http or https URL for a running Cockpit.");
  process.exit(2);
}

if (!/^0x[0-9a-fA-F]{40}$/.test(process.env.CIRCLE_PROOF_RECIPIENT)) {
  fail("CIRCLE_PROOF_RECIPIENT must be a valid EVM address.");
  process.exit(2);
}
if (!/^\d+(?:\.\d{1,6})?$/.test(process.env.CIRCLE_PROOF_AMOUNT_USDC) || Number(process.env.CIRCLE_PROOF_AMOUNT_USDC) <= 0) {
  fail("CIRCLE_PROOF_AMOUNT_USDC must be a positive USDC decimal with at most 6 places.");
  process.exit(2);
}

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  fail("the optional proof runner requires Playwright in the calling environment. Install it outside the repository, then rerun this script; no browser proof is claimed without the interactive runner.");
  process.exit(2);
}

let browser;
try {
  browser = await chromium.launch({ headless: false });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  await page.goto(new URL("/cockpit", proofUrl).toString(), { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: "Direct payment", exact: true }).click();
  await page.getByTestId("payment-recipient").fill(process.env.CIRCLE_PROOF_RECIPIENT);
  await page.getByTestId("payment-amount").fill(process.env.CIRCLE_PROOF_AMOUNT_USDC);
  if (process.env.CIRCLE_PROOF_TYPE === "one-time") {
    await page.getByRole("button", { name: "One-time", exact: true }).click();
  }

  await page.getByTestId("circle-passkey-button").click();
  await page.getByTestId("circle-passkey-name").fill(process.env.CIRCLE_PROOF_USERNAME);
  await page.getByTestId("circle-create-passkey").click();
  const settlementButton = page.getByTestId("circle-settlement-submit");
  await settlementButton.waitFor({ state: "visible", timeout: 120_000 });
  if (!(await settlementButton.isEnabled())) {
    fail("Circle passkey creation completed without enabling the sponsored settlement action.");
    process.exit(2);
  }
  await settlementButton.click();

  const toast = page.getByTestId("cockpit-toast");
  await toast.waitFor({ state: "visible", timeout: 180_000 });
  const text = await toast.textContent();
  if (!text || !text.includes("Circle settlement verified") || !text.includes("tx 0x") || !text.includes("payer 0x")) {
    fail("Cockpit did not expose the exact verified Circle settlement receipt and payer evidence.");
    process.exit(2);
  }

  console.log(`[${proofName}] PASS: Cockpit reported exact receipt and live Vault verification.`);
  console.log(text.replace(/\s+/g, " ").trim());
} catch {
  fail("interactive passkey, sponsorship, receipt, or Vault verification did not complete. Inspect the visible Cockpit state without treating this run as a proof.");
} finally {
  await browser?.close();
}
