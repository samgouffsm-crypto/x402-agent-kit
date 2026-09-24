// Unit tests: 402 parsing + exact-scheme envelope building. No network,
// no real keys. The signing test uses the well-known Anvil throwaway key
// (0xac09…) which holds no mainnet funds and is never used for payments.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { recoverTypedDataAddress, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  parsePaymentRequirements,
  selectRequirement,
  signExactAuthorization,
  buildExactPaymentHeader,
  loadOperatorKey,
  BASE_NETWORK,
  USDC_BASE,
  type AcceptsEntry,
} from "../src/payment.js";
import { TOOLS } from "../src/tools.generated.js";
import { inputShapeFor } from "../src/schema.js";
import { z } from "zod";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (n: string) =>
  readFileSync(join(here, "fixtures", n), "utf8").trim();

// Deterministic synthetic test key — obviously not a real wallet, holds no
// funds, used only to exercise the signing code path (never for payments).
const TEST_KEY = keccak256(toHex("x402-services mcp-server unit-test key")) as `0x${string}`;
const TEST_ADDR = privateKeyToAccount(TEST_KEY).address;

describe("parsePaymentRequirements", () => {
  it("decodes a real tenderwatch 402 header (exact scheme)", () => {
    const reqs = parsePaymentRequirements(fixture("tenderwatch-402.b64"));
    expect(reqs.x402Version).toBe(2);
    const a = reqs.accepts[0];
    expect(a.scheme).toBe("exact");
    expect(a.network).toBe(BASE_NETWORK);
    expect(a.amount).toBe("20000");
    expect(a.asset.toLowerCase()).toBe(USDC_BASE.toLowerCase());
    expect(a.payTo).toBe("0x11297bb942475a0df8558987c5b055377952738c");
  });

  it("decodes a real docextract 402 header (upto scheme)", () => {
    const reqs = parsePaymentRequirements(fixture("docextract-402.b64"));
    expect(reqs.accepts[0].scheme).toBe("upto");
    expect(reqs.accepts[0].network).toBe(BASE_NETWORK);
  });

  it("rejects garbage and header-shaped non-JSON", () => {
    expect(() => parsePaymentRequirements("!!!not-base64!!!")).toThrow();
    expect(() =>
      parsePaymentRequirements(Buffer.from(JSON.stringify({})).toString("base64"))
    ).toThrow(/accepts/);
  });
});

describe("selectRequirement", () => {
  const exact: AcceptsEntry = {
    scheme: "exact",
    network: BASE_NETWORK,
    amount: "20000",
    asset: USDC_BASE,
    payTo: "0x11297bb942475a0df8558987c5b055377952738c",
    maxTimeoutSeconds: 300,
  };
  it("prefers exact on Base mainnet", () => {
    const upto = { ...exact, scheme: "upto" };
    expect(selectRequirement({ x402Version: 2, accepts: [upto, exact] })).toBe(exact);
  });
  it("falls back to the first entry", () => {
    const upto = { ...exact, scheme: "upto" };
    expect(selectRequirement({ x402Version: 2, accepts: [upto] })).toBe(upto);
  });
});

describe("signExactAuthorization", () => {
  const entry: AcceptsEntry = {
    scheme: "exact",
    network: BASE_NETWORK,
    amount: "20000",
    asset: USDC_BASE,
    payTo: "0x11297bb942475a0df8558987c5b055377952738c",
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };

  it("produces a signature that recovers to the signer", async () => {
    const now = 1_750_000_000;
    const { signature, authorization } = await signExactAuthorization(entry, TEST_KEY, now);
    expect(authorization.from).toBe(TEST_ADDR);
    expect(authorization.to).toBe(entry.payTo);
    expect(authorization.value).toBe("20000");
    expect(authorization.validAfter).toBe("0");
    expect(authorization.validBefore).toBe(String(now + 300));
    expect(authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/);

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "USD Coin",
        version: "2",
        chainId: 8453,
        verifyingContract: USDC_BASE as `0x${string}`,
      },
      types: {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      },
      primaryType: "TransferWithAuthorization",
      message: {
        from: authorization.from as `0x${string}`,
        to: authorization.to as `0x${string}`,
        value: BigInt(authorization.value),
        validAfter: BigInt(authorization.validAfter),
        validBefore: BigInt(authorization.validBefore),
        nonce: authorization.nonce as `0x${string}`,
      },
      signature,
    });
    expect(recovered).toBe(TEST_ADDR);
  });

  it("respects maxTimeoutSeconds", async () => {
    const now = 1_750_000_000;
    const { authorization } = await signExactAuthorization(
      { ...entry, maxTimeoutSeconds: 60 },
      TEST_KEY,
      now
    );
    expect(authorization.validBefore).toBe(String(now + 60));
  });

  it("refuses non-exact schemes", async () => {
    await expect(
      signExactAuthorization({ ...entry, scheme: "upto" }, TEST_KEY)
    ).rejects.toThrow(/exact/);
  });
});

describe("buildExactPaymentHeader", () => {
  it("builds the verified envelope shape", async () => {
    const entry: AcceptsEntry = {
      scheme: "exact",
      network: BASE_NETWORK,
      amount: "20000",
      asset: USDC_BASE,
      payTo: "0x11297bb942475a0df8558987c5b055377952738c",
      maxTimeoutSeconds: 300,
      extra: { name: "USD Coin", version: "2" },
    };
    const { signature, authorization } = await signExactAuthorization(entry, TEST_KEY, 1_750_000_000);
    const header = buildExactPaymentHeader(entry, signature, authorization);
    const env = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    expect(env.x402Version).toBe(2);
    expect(env.scheme).toBe("exact");
    expect(env.network).toBe(BASE_NETWORK);
    expect(env.payload.signature).toBe(signature);
    expect(env.payload.authorization).toEqual(authorization);
  });
});

describe("loadOperatorKey", () => {
  const saved = process.env.X402_PRIVATE_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.X402_PRIVATE_KEY;
    else process.env.X402_PRIVATE_KEY = saved;
  });
  it("throws a helpful error when unset", () => {
    delete process.env.X402_PRIVATE_KEY;
    expect(() => loadOperatorKey()).toThrow(/X402_PRIVATE_KEY is not set/);
  });
  it("rejects malformed keys", () => {
    process.env.X402_PRIVATE_KEY = "nope";
    expect(() => loadOperatorKey()).toThrow(/64-hex/);
  });
  it("accepts a well-formed key", () => {
    process.env.X402_PRIVATE_KEY = TEST_KEY;
    expect(loadOperatorKey()).toBe(TEST_KEY);
  });
});

describe("generated tool definitions", () => {
  it("has 22 unique tools with valid routing info", () => {
    expect(TOOLS).toHaveLength(22);
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(22);
    for (const t of TOOLS) {
      expect(t.baseUrl).toMatch(/^https:\/\/x402-/);
      expect(["GET", "POST"]).toContain(t.method);
      expect(t.path).toMatch(/^\//);
      expect(["query", "json", "multipart-file"]).toContain(t.bodyKind);
    }
  });

  it("every tool input schema converts to zod and validates", () => {
    for (const t of TOOLS) {
      const shape = inputShapeFor(t.inputSchema);
      const schema = z.object(shape);
      // Empty args must parse whenever nothing is required.
      const parsed = schema.safeParse({});
      if (t.inputSchema.required.length > 0) {
        expect(parsed.success).toBe(false);
      } else {
        expect(parsed.success).toBe(true);
      }
      // Wrong primitive type must fail.
      const firstStringKey = Object.keys(t.inputSchema.properties).find(
        (k) => (t.inputSchema.properties[k] as { type?: string }).type === "string"
      );
      if (firstStringKey) {
        expect(schema.safeParse({ [firstStringKey]: 12345 }).success).toBe(false);
      }
    }
  });

  it("docextract accepts a base64 file plus filename", () => {
    const t = TOOLS.find((x) => x.name === "docextract_extract")!;
    expect(t.bodyKind).toBe("multipart-file");
    expect(t.inputSchema.required).toContain("file");
    expect(t.inputSchema.properties).toHaveProperty("fileName");
  });
});
