# x402 Agent Kit

Integration materials for calling nine pay-per-call data APIs for AI agents —
no API keys, no signup, USDC on Base via the x402 protocol. By **Jebadiah**.

- [`quickstart.md`](quickstart.md) — the x402 payment flow in 3 steps, with a verified Python example and TypeScript one-liner
- [`openai-functions.json`](openai-functions.json) — 22 OpenAI function-calling tool definitions (one per priced endpoint)
- [`mcp-manifest.json`](mcp-manifest.json) — MCP-style tool manifest with x402 annotations
- [`langchain-tools.py`](langchain-tools.py) — LangChain `@tool` wrappers with automatic 402 handling
- [`x402-services/SKILL.md`](x402-services/SKILL.md) — Claude Code skill: drop this folder into your skills directory

## MCP server — run from source (no npm needed)

[`mcp-server/`](mcp-server/) is a stdio MCP server exposing all nine services
as 22 MCP tools, with automatic x402 payment handling. There is no npm
release yet, so run it straight from this repo:

```sh
git clone https://github.com/samgouffsm-crypto/x402-agent-kit
cd x402-agent-kit/mcp-server
npm install && npm run build
```

Point your MCP client at it:

```json
{
  "mcpServers": {
    "x402-services": {
      "command": "node",
      "args": ["<repo>/mcp-server/dist/index.js"],
      "env": { "X402_PRIVATE_KEY": "0xYOUR_KEY" }
    }
  }
}
```

Fund your own Base wallet with a little USDC; the key only ever signs gasless
EIP-3009 authorizations on your machine. Full setup in
[`mcp-server/README.md`](mcp-server/README.md).

## The services

| Service | Endpoint | Price |
|---|---|---|
| TenderWatch — gov procurement search + fit-scoring | https://x402-tenderwatch.onrender.com | $0.01–$0.02/call |
| EDGAR Lens — SEC filing search/extraction | https://x402-edgar-lens.onrender.com | $0.02–$0.05/call |
| TrialScope — clinical trial search/deltas | https://x402-trialscope.onrender.com | $0.01–$0.02/call |
| DocExtract — PDF → structured JSON | https://x402-docextract.onrender.com | ≤$0.10/doc |
| PatentScope — patent search/prior-art | https://x402-patentscope.onrender.com | $0.02–$0.05/call |
| Alexandria — auto parts intelligence | https://x402-alexandria.onrender.com | $0.02–$0.05/call |
| InvoiceIQ — AP invoice extraction | https://x402-invoiceiq.onrender.com | $0.05/doc |
| TaxRate US — state sales-tax rate + nexus | https://x402-taxrate.onrender.com | $0.03 ($0.01 nexus) |
| EntityVerify — business verification | https://x402-entityverify.onrender.com | $0.07/check |

Each service also serves `/llms.txt`, `/openapi.json`, and `/.well-known/x402`.
