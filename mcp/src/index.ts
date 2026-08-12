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
  discoverAgentSurface,
  openrailsCapabilities,
  planAgentAction,
  prepareOperation,
  readInterfaceObject,
  validateOperation,
  verifyOperation,
} from "./tools.js";

const ctx = buildContext();
const server = new McpServer({ name: "openrails-mcp", version: "0.3.1" });

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
  "openrails_agent_discover",
  {
    description: "Validate and describe a payable agent surface. Discovery never authorizes payment or creates a signer.",
    inputSchema: {
      openrailsId: z.string().describe("Stable OpenRails identifier for the discovered service."),
      providerId: z.string().describe("Provider identifier from the service manifest."),
      manifest: z.record(z.unknown()).describe("OpenRails surface manifest."),
      eventType: z.string().optional().describe("Discovery event type, default marketplace.service_arrived."),
    },
  },
  async (args) => run(() => discoverAgentSurface(ctx, args)),
);

server.registerTool(
  "openrails_agent_plan",
  {
    description: "Plan an inspect, quote, negotiate, ignore, or mute action for a discovered surface. It never authorizes payment.",
    inputSchema: {
      event: z.record(z.unknown()).describe("Discovery event returned by openrails_agent_discover."),
      action: z.enum(["inspect", "quote", "negotiate", "ignore", "mute"]),
    },
  },
  async (args) => run(() => planAgentAction(ctx, args)),
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
