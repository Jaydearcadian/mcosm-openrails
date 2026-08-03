#!/usr/bin/env node
/**
 * OpenRails MCP server (stdio).
 *
 * This release exposes only safe Shared Interface operations. It can read,
 * prepare, validate, and verify data. An external wallet remains responsible
 * for signatures and transaction submission.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { buildContext } from "./context.js";
import {
  openrailsCapabilities,
  prepareOperation,
  readInterfaceObject,
  validateOperation,
  verifyOperation,
} from "./tools.js";

const ctx = buildContext();
const server = new McpServer({ name: "openrails-mcp", version: "0.2.0-rc.1" });

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function ok(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

function fail(error: unknown): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  };
}

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (error) {
    return fail(error);
  }
}

server.registerTool(
  "openrails_capabilities",
  {
    description: "Report Shared Interface capabilities and the safe-only MCP boundary.",
    inputSchema: {},
  },
  async () => run(() => openrailsCapabilities(ctx)),
);

server.registerTool(
  "openrails_prepare",
  {
    description: "Prepare a Shared Interface operation envelope. No signer is created, no key is accepted, and nothing is broadcast.",
    inputSchema: {
      operationId: z.string().describe("Registered Shared Interface operation id or capability."),
      data: z.unknown().describe("Operation data matching the registered request schema."),
      context: z.record(z.unknown()).optional().describe("Optional workspace, path, pact, proof, and subject references."),
    },
  },
  async (args) => run(() => prepareOperation(ctx, args)),
);

server.registerTool(
  "openrails_validate",
  {
    description: "Validate a Shared Interface request or response envelope without signing or broadcasting it.",
    inputSchema: {
      operationId: z.string(),
      direction: z.enum(["request", "response"]).optional(),
      envelope: z.record(z.unknown()),
    },
  },
  async (args) => run(() => validateOperation(ctx, args)),
);

server.registerTool(
  "openrails_verify",
  {
    description: "Verify an operation envelope and an optional Pact-declared Canonical Record binding. Financial success is never claimed here.",
    inputSchema: {
      operationId: z.string(),
      direction: z.enum(["request", "response"]).optional(),
      envelope: z.record(z.unknown()),
      record: z.record(z.unknown()).optional(),
      pact: z.record(z.unknown()).optional(),
    },
  },
  async (args) => run(() => verifyOperation(ctx, args)),
);

server.registerTool(
  "openrails_read",
  {
    description: "Read the bundled network manifest or capability declarations. Other objects require a replaceable indexer adapter.",
    inputSchema: {
      type: z.string().describe("network, networkManifest, capabilities, or another Shared Interface object type."),
      id: z.string().optional(),
    },
  },
  async (args) => run(() => readInterfaceObject(ctx, args)),
);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`openrails-mcp ready · ${ctx.config.networkMode} · safe-only prepare/verify surface`);
}

main().catch((error) => {
  console.error("openrails-mcp failed to start:", error);
  process.exit(1);
});
