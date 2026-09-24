# Calling Jebadiah's x402 services — agent quickstart

Six pay-per-call data APIs for AI agents. No API keys, no signup, no subscription.
Every priced route returns **HTTP 402** until paid; you pay by signing a gasless
USDC authorization (EIP-3009) and retrying. USDC on **Base mainnet** (`eip155:8453`).

| Service | What it does | Base URL | Price/call |
|---|---|---|---|
| TenderWatch | Gov procurement search (EU TED + US SAM.gov) + fit-scoring | https://x402-tenderwatch.onrender.com | $0.01–$0.02 |
| EDGAR Lens | SEC filing search, Item 1A/MD&A extraction, briefs | https://x402-edgar-lens.onrender.com | $0.02–$0.05 |
| TrialScope | ClinicalTrials.gov search, dossiers, change-deltas | https://x402-trialscope.onrender.com | $0.01–$0.02 |
| DocExtract | PDF → structured JSON (invoices, contracts) | https://x402-docextract.onrender.com | ≤$0.10/doc |
| PatentScope | USPTO search, claims, prior-art ranking | https://x402-patentscope.onrender.com | $0.02–$0.05 |
| Alexandria | Auto parts intelligence (parts, fitment, failures) | https://x402-alexandria.onrender.com | $0.02–$0.05 |

Machine-readable: every service serves `/llms.txt`, `/openapi.json`, and
`/.well-known/x402`. Terms: `GET /terms` (free).

## The payment flow (3 steps)

1. **Call the endpoint.** You get `402 Payment Required` with a `payment-required`
   header: base64 JSON `{x402Version: 2, accepts: [{scheme: "exact",
   network: "eip155:8453", amount: "<base units, 6 decimals>", asset: "<USDC>",
   payTo: "<0x…>", maxTimeoutSeconds: 300, extra: {name: "USD Coin", version: "2"}}]}`.
2. **Sign an EIP-3009 `transferWithAuthorization`** on Base USDC
   (`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`) for `amount` to `payTo`.
   Gasless — the payer only signs; the facilitator submits.
3. **Retry with `X-PAYMENT`**: base64 JSON
   `{x402Version: 2, scheme: "exact", network: "eip155:8453",
   payload: {signature: "0x…", authorization: {from, to, value, validAfter,
   validBefore, nonce}}}`. Success returns 200 with a `payment-response` header.

Your wallet needs enough Base USDC to cover the call. That is the entire
integration — no registration anywhere.

## Python example (verified against the live 402 format)

```python
import base64, json, os, secrets, time
import requests
from eth_account import Account
from eth_account.messages import encode_typed_data

USDC, CHAIN_ID = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", 8453

def paid_request(method, url, private_key=os.environ["PAYER_KEY"], **kw):
    acct = Account.from_key(private_key)
    r = requests.request(method, url, timeout=90, **kw)
    if r.status_code != 402:                      # free route or already paid
        r.raise_for_status(); return r.json()
    terms = json.loads(base64.b64decode(r.headers["payment-required"]))
    a = terms["accepts"][0]                       # scheme "exact", eip155:8453
    valid_before = str(int(time.time()) + a.get("maxTimeoutSeconds", 300))
    nonce = "0x" + secrets.token_bytes(32).hex()
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"}],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"}]},
        "primaryType": "TransferWithAuthorization",
        "domain": {"name": "USD Coin", "version": "2",
                   "chainId": CHAIN_ID, "verifyingContract": USDC},
        "message": {"from": acct.address, "to": a["payTo"], "value": int(a["amount"]),
                    "validAfter": 0, "validBefore": int(valid_before),
                    "nonce": bytes.fromhex(nonce[2:])},
    }
    sig = "0x" + acct.sign_message(encode_typed_data(full_message=typed)).signature.hex()
    payload = {"x402Version": 2, "scheme": a["scheme"], "network": a["network"],
               "payload": {"signature": sig,
                           "authorization": {"from": acct.address, "to": a["payTo"],
                               "value": str(a["amount"]), "validAfter": "0",
                               "validBefore": valid_before, "nonce": nonce}}}
    headers = dict(kw.pop("headers", {}))
    headers["X-PAYMENT"] = base64.b64encode(json.dumps(payload).encode()).decode()
    r = requests.request(method, url, headers=headers, timeout=90, **kw)
    r.raise_for_status(); return r.json()

# Example: search SEC filings for "revenue recognition" ($0.02)
print(paid_request("GET", "https://x402-edgar-lens.onrender.com/search",
                   params={"q": "revenue recognition", "forms": "10-K", "limit": 5}))
```

Requires: `pip install requests eth-account web3`.

## TypeScript one-liner (official SDK)

```ts
import { x402Client } from "@x402/fetch";          // npm i @x402/fetch viem
import { privateKeyToAccount } from "viem/accounts";

const client = new x402Client(privateKeyToAccount(process.env.PAYER_KEY as `0x${string}`));
const res = await client.fetch("https://x402-tenderwatch.onrender.com/search?q=solar+NAICS+221114");
console.log(await res.json());                    // 402 handled automatically
```

## Notes for agent builders

- Amounts are in USDC base units (6 decimals): `"20000"` = $0.02.
- `validBefore` must be within `maxTimeoutSeconds` of now or verification fails.
- Free routes: `/health`, `/terms`, `/llms.txt`, `/openapi.json`, `/.well-known/x402`.
- These services are live on Base mainnet. Payment *requirement* generation is
  production-verified; if a paid call misbehaves, the 402 terms are the source
  of truth for amount/asset/payee.
- Operated by Jebadiah. No affiliation with the upstream data sources
  (SEC, USPTO, ClinicalTrials.gov, TED, SAM.gov).
