// Builds the HTTP request for a tool call and runs the x402 pay→retry flow.
//
// "exact" scheme  -> manual EIP-3009 flow (src/payment.ts), operator's key.
// Any other scheme -> delegated to the official @x402/fetch client
//   (today that is only docextract /extract on the "upto" scheme, which
//   needs Permit2 signing that we do not reimplement).
import type { McpToolDef } from "./tools.generated.js";
import {
  parsePaymentRequirements,
  selectRequirement,
  signExactAuthorization,
  buildExactPaymentHeader,
  loadOperatorKey,
} from "./payment.js";

/** Public Base RPC used for the official-client (upto/permit2) path. */
export const DEFAULT_RPC_URL = "https://mainnet.base.org";

export interface PaidCallResult {
  status: number;
  body: unknown;
  /** present when a payment was made for this call */
  payment?: { scheme: string; network: string; amount: string; asset: string; payTo: string };
}

export function buildRequest(tool: McpToolDef, args: Record<string, unknown>): { url: string; init: RequestInit } {
  let path = tool.path;
  const remaining: Record<string, unknown> = { ...args };
  for (const p of tool.pathParams) {
    const v = remaining[p];
    if (v === undefined || v === null || v === "") {
      throw new Error(`missing required path parameter "${p}"`);
    }
    path = path.replace(`{${p}}`, encodeURIComponent(String(v)));
    delete remaining[p];
  }
  const url = `${tool.baseUrl}${path}`;
  if (tool.method === "GET") {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(remaining)) {
      if (v === undefined || v === null) continue;
      qs.set(k, String(v));
    }
    const q = qs.toString();
    return { url: q ? `${url}?${q}` : url, init: { method: "GET" } };
  }
  if (tool.bodyKind === "multipart-file") {
    const fileB64 = remaining.file;
    if (typeof fileB64 !== "string" || fileB64.length === 0) {
      throw new Error('docextract_extract needs "file" as base64-encoded PDF content');
    }
    const form = new FormData();
    const bytes = Buffer.from(fileB64, "base64");
    if (bytes.length === 0) throw new Error('"file" did not decode as base64');
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: "application/pdf" }),
      typeof remaining.fileName === "string" && remaining.fileName ? remaining.fileName : "upload.pdf"
    );
    return { url, init: { method: "POST", body: form } };
  }
  return {
    url,
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(remaining),
    },
  };
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Call a priced endpoint, paying via x402 when it 402s.
 * Throws on transport errors, on unpaid non-2xx responses, and when a paid
 * call needs X402_PRIVATE_KEY and it is missing/invalid.
 */
export async function paidCall(
  tool: McpToolDef,
  args: Record<string, unknown>,
  opts: { timeoutMs?: number; rpcUrl?: string } = {}
): Promise<PaidCallResult> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const { url, init } = buildRequest(tool, args);

  const first = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (first.status !== 402) {
    if (!first.ok) {
      throw new Error(`${tool.name}: HTTP ${first.status}: ${JSON.stringify(await readBody(first)).slice(0, 500)}`);
    }
    return { status: first.status, body: await readBody(first) };
  }

  const header = first.headers.get("payment-required");
  if (!header) throw new Error(`${tool.name}: got 402 without a payment-required header`);
  const reqs = parsePaymentRequirements(header);
  const entry = selectRequirement(reqs);

  if (entry.scheme === "exact") {
    const key = loadOperatorKey();
    const { signature, authorization } = await signExactAuthorization(entry, key);
    const retry = await fetch(url, {
      ...init,
      headers: { ...(init.headers || {}), "X-PAYMENT": buildExactPaymentHeader(entry, signature, authorization) },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!retry.ok) {
      throw new Error(
        `${tool.name}: paid request failed HTTP ${retry.status}: ${JSON.stringify(await readBody(retry)).slice(0, 500)}`
      );
    }
    return {
      status: retry.status,
      body: await readBody(retry),
      payment: { scheme: entry.scheme, network: entry.network, amount: entry.amount, asset: entry.asset, payTo: entry.payTo },
    };
  }

  // Non-exact schemes (today: docextract /extract on "upto"): delegate to the
  // official x402 client, which implements the Permit2-based signing.
  const key = loadOperatorKey();
  const { wrapFetchWithPayment, x402Client } = await import("@x402/fetch");
  const { UptoEvmScheme } = await import("@x402/evm/upto/client");
  const { privateKeyToAccount } = await import("viem/accounts");
  const x402 = new x402Client().register(
    "eip155:8453",
    new UptoEvmScheme(privateKeyToAccount(key), {
      rpcUrl: opts.rpcUrl ?? DEFAULT_RPC_URL,
    })
  );
  const fetchWithPay = wrapFetchWithPayment(fetch, x402);
  const retry = await fetchWithPay(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!retry.ok) {
    throw new Error(
      `${tool.name}: paid request (${entry.scheme}) failed HTTP ${retry.status}: ${(await retry.text()).slice(0, 500)}`
    );
  }
  let body: unknown;
  try {
    body = await retry.json();
  } catch {
    body = await retry.text();
  }
  return {
    status: retry.status,
    body,
    payment: { scheme: entry.scheme, network: entry.network, amount: entry.amount, asset: entry.asset, payTo: entry.payTo },
  };
}
