import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cockpitSourceUrl = new URL("../src/pages/Cockpit.tsx", import.meta.url);
const guidanceSourceUrl = new URL("../src/lib/guidance.ts", import.meta.url);
const styleSourceUrl = new URL("../src/gasok/product.css", import.meta.url);
const shellSourceUrl = new URL("../src/gasok/components/ProductShell.tsx", import.meta.url);

test("the App keeps orientation and Workspace guidance as separate persisted scopes", async () => {
  const [cockpit, guidance] = await Promise.all([
    readFile(cockpitSourceUrl, "utf8"),
    readFile(guidanceSourceUrl, "utf8"),
  ]);

  assert.match(guidance, /const GUIDE_VERSION = "v3"/);
  assert.match(guidance, /export type GuideKind = "orientation" \| "workspace"/);
  assert.match(cockpit, /useFirstRunGuide\("app", "orientation"\)/);
  assert.match(cockpit, /useFirstRunGuide\(guidanceScope\(address, records\.selectedId \|\| undefined\), "workspace"\)/);
});

test("the quick tour points to existing App controls", async () => {
  const [cockpit, shell] = await Promise.all([
    readFile(cockpitSourceUrl, "utf8"),
    readFile(shellSourceUrl, "utf8"),
  ]);

  for (const target of ["wallet-control", "direct-payment", "workspace-entry", "lifecycle", "app-views"]) {
    assert.match(`${cockpit}\n${shell}`, new RegExp(`data-tour-target="${target}"`));
  }

  assert.match(cockpit, /querySelector<HTMLElement>\(`\[data-tour-target=/);
  assert.match(cockpit, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
});

test("the setup helper derives progress from existing Workspace records", async () => {
  const cockpit = await readFile(cockpitSourceUrl, "utf8");

  assert.match(cockpit, /useNavigatorPreference\(guidanceScope\(address, records\.selectedId \|\| undefined\)\)/);
  assert.match(cockpit, /workspace\?\.actors\.some/);
  assert.match(cockpit, /workspace\?\.paths\.some/);
  assert.match(cockpit, /workspace\?\.pacts\.some/);
  assert.match(cockpit, /workspace\?\.proofs\.length/);
  assert.match(cockpit, /workspace\?\.payments\.length/);
  assert.match(cockpit, /<SetupNavigator steps=\{setupSteps\}/);
});

test("the setup helper starts collapsed and Enter App is hidden inside the App", async () => {
  const [guidance, shell] = await Promise.all([
    readFile(guidanceSourceUrl, "utf8"),
    readFile(shellSourceUrl, "utf8"),
  ]);

  assert.match(guidance, /const NAVIGATOR_VERSION = "v2"/);
  assert.match(guidance, /useNavigatorPreference[\s\S]*useState\(false\)/);
  assert.match(guidance, /readBoolean\(storageKey\("navigator", scope\), false\)/);
  assert.match(shell, /const inApp = pathname === "\/app" \|\| pathname\.startsWith\("\/app\/"\)/);
  assert.match(shell, /\{!inApp && <Link className="enter-app"/);
});

test("the App collapses product navigation behind an accessible menu", async () => {
  const shell = await readFile(shellSourceUrl, "utf8");

  assert.match(shell, /className="app-menu-trigger"/);
  assert.match(shell, /aria-expanded=\{menuOpen\}/);
  assert.match(shell, /aria-controls="app-product-menu"/);
  assert.match(shell, /className="app-product-menu"/);
  assert.match(shell, /if \(event\.key === "Escape"\) setMenuOpen\(false\)/);
  assert.match(shell, /\{!inApp && <nav aria-label="Primary navigation">/);
});

test("the Workspace guide navigates existing views without replacing their operations", async () => {
  const cockpit = await readFile(cockpitSourceUrl, "utf8");

  for (const target of ["workspace", "authority", "payments", "records", "activity"]) {
    assert.match(cockpit, new RegExp(`data-tour-target="${target}"`));
  }

  assert.match(cockpit, /<NewPaymentModal open=\{paymentModal\}/);
  assert.match(cockpit, /records\.initialize\(name, address!\)/);
  assert.match(cockpit, /records\.addPath/);
  assert.match(cockpit, /records\.addPact/);
  assert.match(cockpit, /records\.addProof/);
});

test("term explanations work with pointer, keyboard focus, and disclosure state", async () => {
  const [cockpit, styles] = await Promise.all([
    readFile(cockpitSourceUrl, "utf8"),
    readFile(styleSourceUrl, "utf8"),
  ]);

  assert.match(cockpit, /<details className="or-term-help">/);
  assert.match(cockpit, /<summary aria-label=\{`Explain \$\{term\}`\}/);
  assert.match(styles, /\.or-term-help:hover>div/);
  assert.match(styles, /\.or-term-help:focus-within>div/);
  assert.match(styles, /\.or-term-help\[open\]>div/);
});
