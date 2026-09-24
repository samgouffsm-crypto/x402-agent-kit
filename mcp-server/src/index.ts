#!/usr/bin/env node
// MCP server: Jebadiah's x402 pay-per-call data APIs on Base mainnet.
//
// Stdio transport. Each priced endpoint is one tool; on HTTP 402 the server
// signs an x402 payment with the OPERATOR's key (X402_PRIVATE_KEY — the
// caller's key, never ours) and retries. See README.md.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TOOLS } from "./tools.generated.js";
import { inputShapeFor } from "./schema.js";
import { paidCall } from "./client.js";

const server = new McpServer({
  name: "@jebadiah/x402-services",
  version: "0.1.0",
});

for (const tool of TOOLS) {
  server.registerTool(
    tool.name,
    {
      title: tool.name,
      description: `${tool.description} Price: ${tool.price} USDC per call on Base (x402).`,
      inputSchema: inputShapeFor(tool.inputSchema),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (args) => {
      try {
        const result = await paidCall(tool, args as Record<string, unknown>);
        const lines = [
          `OK (${tool.name}, HTTP ${result.status}${result.payment ? `, paid ${result.payment.amount} base units via x402 ${result.payment.scheme}` : ""})`,
          typeof result.body === "string" ? result.body : JSON.stringify(result.body, null, 2),
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e) {
        return {
          content: [{ type: "text" as const, text: `ERROR calling ${tool.name}: ${(e as Error).message}` }],
          isError: true,
        };
      }
    }
  );
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Note: keep stdout clean — MCP speaks JSON-RPC on stdout. Log to stderr.
  console.error(
    `@jebadiah/x402-services: ${TOOLS.length} tools registered (x402 on Base mainnet). ` +
      (process.env.X402_PRIVATE_KEY
        ? "Operator key present — paid calls enabled."
        : "No X402_PRIVATE_KEY — paid calls will error until it is set.")
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
