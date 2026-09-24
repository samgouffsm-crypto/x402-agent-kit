# @jebadiah/x402-services — MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes **Jebadiah's six
x402 pay-per-call data APIs** as 18 MCP tools. Agent operators point their MCP
client at this server, fund their own wallet with a little Base USDC, and call
the tools — x402 payments are handled automatically per call.

| Service | Tools | Price/call |
|---|---|---|
| TenderWatch — gov procurement search + fit-scoring | `tenderwatch_search`, `tenderwatch_opportunity_by_id`, `tenderwatch_fit_score` | $0.01–$0.02 |
| EDGAR Lens — SEC filing search, sections, briefs | `edgar-lens_search`, `edgar-lens_filing_sections`, `edgar-lens_brief` | $0.02–$0.05 |
| TrialScope — clinical trial search, dossiers, deltas | `trialscope_search`, `trialscope_study`, `trialscope_snapshot`, `trialscope_delta` | $0.01–$0.02 |
| DocExtract — PDF → structured JSON | `docextract_extract` | ≤$0.10/doc |
| PatentScope — patent search, claims, prior art | `patentscope_search`, `patentscope_patent`, `patentscope_prior_art` | $0.02–$0.05 |
| Alexandria — auto parts intelligence | `alexandria_parts_search`, `alexandria_fitment_check`, `alexandria_failures`, `alexandria_demand` | $0.02–$0.05 |

Machine-readable service docs: each service serves `/llms.txt`, `/openapi.json`,
and `/.well-known/x402`. Terms: `GET /terms` (free).

## Setup for an agent operator

1. Install: `npm install -g @jebadiah/x402-services` (or run with `npx`).
2. Fund **your own** Base wallet with a little USDC (each call costs $0.01–$0.10).
   Export its private key — this is *your* key, used only to sign gasless
   EIP-3009 payment authorizations. It never leaves your machine.
3. Configure your MCP client (Claude Code, etc.):

```json
{
  "mcpServers": {
    "x402-services": {
      "command": "npx",
      "args": ["-y", "@jebadiah/x402-services"],
      "env": {
        "X402_PRIVATE_KEY": "0xYOUR_KEY",
        "X402_RPC_URL": "https://mainnet.base.org"
      }
    }
  }
}
```

`X402_RPC_URL` is optional (defaults to a public Base RPC); it is used by the
Permit2-based `upto` payment path (DocExtract).

## How payment works

Each tool call hits the service's HTTPS endpoint. Priced routes return
**HTTP 402** with a `payment-required` header; this server parses the
requirements, signs an EIP-3009 `transferWithAuthorization` with *your* key
(scheme `exact` — 17 of 18 tools), base64-encodes the payment envelope, and
retries with the `X-PAYMENT` header. DocExtract's `/extract` uses the x402
`upto` scheme (Permit2) and is handled by the official `@x402/fetch` client.
Signing is gasless for you — the facilitator submits the transaction.

## Honest status

- 402 requirement **generation** is verified against all six live services
  (Base mainnet, `eip155:8453`, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`).
- The paid call path in this server is **implemented but unproven end-to-end**:
  no signed payment has been observed settling on-chain yet. If a paid call
  misbehaves, the live 402 terms are the source of truth for amount/asset/payee.
- Test suite: `npm test` — unit tests for 402 parsing and envelope building
  (fixtures, no network, no real keys) plus a live test that verifies 402
  requirement parsing against the real services **without signing or paying**.

## Development

```sh
npm install
npm run gen    # regenerate src/tools.generated.ts from openai-functions.json
npm run build  # tsc -> dist/
npm test       # vitest (unit + live 402-parsing tests)
```

Tool definitions are generated from
`../marketing/integrations/openai-functions.json` (extracted from the live
OpenAPI specs) — edit the specs, re-run `npm run gen`.

## License

MIT — © 2026 Jebadiah. Operated by Jebadiah; no affiliation with upstream data
sources (SEC, USPTO, ClinicalTrials.gov, TED, SAM.gov).
