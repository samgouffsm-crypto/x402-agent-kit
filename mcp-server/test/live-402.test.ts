// Live test: hit every priced endpoint and verify the 402 requirement
// PARSING against the real services. This test never signs anything and
// never settles a payment — it only checks that each endpoint 402s with a
// well-formed, parseable payment-required header on Base mainnet.
//
// The services run on Render's free tier and may cold-start; requests run
// sequentially with retries and generous timeouts.
// Run with: npx vitest run test/live-402.test.ts
import { describe, it, expect } from "vitest";
import { TOOLS, type McpToolDef } from "../src/tools.generated.js";
import { buildRequest } from "../src/client.js";
import {
  parsePaymentRequirements,
  BASE_NETWORK,
  USDC_BASE,
} from "../src/payment.js";

const PAY_TO = "0x11297bb942475a0df8558987c5b055377952738c";

// Dummy path params — the x402 paywall fires before any route validation,
// so these never reach a handler.
const DUMMY_PATH_PARAMS: Record<string, string> = {
  id: "test",
  cik: "0001234567",
  accession: "0001234567-26-000001",
  nctId: "NCT00000000",
  number: "US10000000",
  snapshotId: "test",
};

function dummyArgs(tool: McpToolDef): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const p of tool.pathParams) args[p] = DUMMY_PATH_PARAMS[p] ?? "test";
  return args;
}

async function fetchWithRetry(url: string, init: RequestInit, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
}

describe("live 402 requirement parsing (no payment settled)", () => {
  it("all 18 priced endpoints 402 with parseable Base-mainnet requirements", async () => {
    for (const tool of TOOLS) {
      let res: Response;
      if (tool.name === "docextract_extract") {
        // The 402 paywall fires before multer parses the upload, so an empty
        // POST is enough to capture the requirements (no file needed).
        res = await fetchWithRetry(`${tool.baseUrl}/extract`, { method: "POST" });
      } else {
        const { url, init } = buildRequest(tool, dummyArgs(tool));
        res = await fetchWithRetry(url, init);
      }
      expect(res.status, `${tool.name}: expected 402`).toBe(402);
      const header = res.headers.get("payment-required");
      expect(header, `${tool.name}: missing payment-required header`).toBeTruthy();
      const reqs = parsePaymentRequirements(header!);
      expect(reqs.accepts.length).toBeGreaterThan(0);
      const a = reqs.accepts[0];
      expect(a.network, `${tool.name}`).toBe(BASE_NETWORK);
      expect(a.asset.toLowerCase(), `${tool.name}`).toBe(USDC_BASE.toLowerCase());
      expect(a.payTo, `${tool.name}`).toBe(PAY_TO);
      expect(BigInt(a.amount) > 0n, `${tool.name}`).toBe(true);
      if (tool.name === "docextract_extract") {
        expect(a.scheme, `${tool.name}`).toBe("upto");
      } else {
        expect(a.scheme, `${tool.name}`).toBe("exact");
      }
    }
  }, 600_000);
});
