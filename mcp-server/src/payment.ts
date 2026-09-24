// x402 payment handling for the MCP server.
//
// Manual flow for the "exact" scheme (the scheme 17 of 18 priced routes use),
// mirroring the format verified against the live services in
// ../marketing/integrations/quickstart.md:
//
//   1. Call the endpoint -> HTTP 402 with a `payment-required` header:
//      base64 JSON {x402Version: 2, accepts: [{scheme: "exact",
//      network: "eip155:8453", amount, asset, payTo, maxTimeoutSeconds,
//      extra: {name, version, ...}}]}
//   2. Sign an EIP-3009 `transferWithAuthorization` with the OPERATOR's key.
//      Gasless for the payer — only a signature, the facilitator submits.
//   3. Retry with the `X-PAYMENT` header: base64 JSON {x402Version: 2,
//      scheme, network, payload: {signature, authorization: {...}}}.
//
// Routes on any other scheme (today: docextract /extract on "upto") are
// delegated to the official @x402/fetch client, which implements them.
import {
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { randomBytes } from "node:crypto";

export const BASE_CHAIN_ID = 8453;
export const BASE_NETWORK = "eip155:8453";
export const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export interface AcceptsEntry {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRequirements {
  x402Version: number;
  accepts: AcceptsEntry[];
  [k: string]: unknown;
}

export interface ExactAuthorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** Decode and validate the `payment-required` response header. Pure. */
export function parsePaymentRequirements(headerValue: string): PaymentRequirements {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(headerValue.trim(), "base64").toString("utf8"));
  } catch (e) {
    throw new Error(`could not base64/JSON-decode payment-required header: ${(e as Error).message}`);
  }
  if (typeof decoded !== "object" || decoded === null) {
    throw new Error("payment-required header did not decode to an object");
  }
  const reqs = decoded as PaymentRequirements;
  if (!Array.isArray(reqs.accepts) || reqs.accepts.length === 0) {
    throw new Error("payment-required header has no accepts[] entries");
  }
  for (const a of reqs.accepts) {
    for (const f of ["scheme", "network", "amount", "asset", "payTo"] as const) {
      if (typeof a[f] !== "string" || a[f].length === 0) {
        throw new Error(`payment-required accepts[] entry missing ${f}`);
      }
    }
  }
  return reqs;
}

/**
 * Pick the requirement to pay: prefer scheme "exact" on Base mainnet,
 * otherwise fall back to the first entry.
 */
export function selectRequirement(reqs: PaymentRequirements): AcceptsEntry {
  return (
    reqs.accepts.find((a) => a.scheme === "exact" && a.network === BASE_NETWORK) ??
    reqs.accepts[0]
  );
}

function chainIdFromNetwork(network: string): number {
  const m = /^eip155:(\d+)$/.exec(network);
  if (!m) throw new Error(`unsupported network ${network} (expected eip155:<chainId>)`);
  return Number(m[1]);
}

const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

/**
 * Build + sign the EIP-3009 transferWithAuthorization for an "exact"
 * requirement using the operator's key. Returns the signature and the
 * authorization fields exactly as the X-PAYMENT envelope expects them.
 *
 * @param entry  the accepted requirement (scheme must be "exact")
 * @param privateKey  operator's 0x-prefixed private key (their key, never ours)
 * @param nowSeconds  injectable clock (defaults to Date.now); validBefore is
 *                    now + maxTimeoutSeconds, per the verified live format.
 */
export async function signExactAuthorization(
  entry: AcceptsEntry,
  privateKey: `0x${string}`,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<{ signature: `0x${string}`; authorization: ExactAuthorization }> {
  if (entry.scheme !== "exact") {
    throw new Error(`signExactAuthorization only handles scheme "exact", got ${entry.scheme}`);
  }
  const account: PrivateKeyAccount = privateKeyToAccount(privateKey);
  const chainId = chainIdFromNetwork(entry.network);
  const extra = entry.extra ?? {};
  const domain = {
    name: typeof extra.name === "string" ? extra.name : "USD Coin",
    version: typeof extra.version === "string" ? extra.version : "2",
    chainId,
    verifyingContract: entry.asset as `0x${string}`,
  };
  const validBefore = BigInt(nowSeconds + (entry.maxTimeoutSeconds || 300));
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;
  const signature = await account.signTypedData({
    domain,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: "TransferWithAuthorization",
    message: {
      from: account.address,
      to: entry.payTo as `0x${string}`,
      value: BigInt(entry.amount),
      validAfter: 0n,
      validBefore,
      nonce,
    },
  });
  return {
    signature,
    authorization: {
      from: account.address,
      to: entry.payTo,
      value: String(entry.amount),
      validAfter: "0",
      validBefore: validBefore.toString(),
      nonce,
    },
  };
}

/** Build the X-PAYMENT header value (base64 JSON envelope) for an exact payment. */
export function buildExactPaymentHeader(
  entry: AcceptsEntry,
  signature: `0x${string}`,
  authorization: ExactAuthorization
): string {
  const envelope = {
    x402Version: 2,
    scheme: entry.scheme,
    network: entry.network,
    payload: { signature, authorization },
  };
  return Buffer.from(JSON.stringify(envelope), "utf8").toString("base64");
}

/** Load + validate the operator's private key from env. Throws a clear error. */
export function loadOperatorKey(): `0x${string}` {
  const key = process.env.X402_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "X402_PRIVATE_KEY is not set — paid calls need the operator's own Base key " +
        "(a wallet holding enough Base USDC for the call). Free routes work without it."
    );
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(key.trim())) {
    throw new Error("X402_PRIVATE_KEY must be a 0x-prefixed 64-hex-char private key");
  }
  return key.trim() as `0x${string}`;
}
