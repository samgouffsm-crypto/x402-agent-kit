# x402 Agent Kit

Integration materials for calling six pay-per-call data APIs for AI agents —
no API keys, no signup, USDC on Base via the x402 protocol. By **Jebadiah**.

- [`quickstart.md`](quickstart.md) — the x402 payment flow in 3 steps, with a verified Python example and TypeScript one-liner
- [`openai-functions.json`](openai-functions.json) — 18 OpenAI function-calling tool definitions (one per priced endpoint)
- [`mcp-manifest.json`](mcp-manifest.json) — MCP-style tool manifest with x402 annotations
- [`langchain-tools.py`](langchain-tools.py) — LangChain `@tool` wrappers with automatic 402 handling
- [`x402-services/SKILL.md`](x402-services/SKILL.md) — Claude Code skill: drop this folder into your skills directory

## The services

| Service | Endpoint | Price |
|---|---|---|
| TenderWatch — gov procurement search + fit-scoring | https://x402-tenderwatch.onrender.com | $0.01–$0.02/call |
| EDGAR Lens — SEC filing search/extraction | https://x402-edgar-lens.onrender.com | $0.02–$0.05/call |
| TrialScope — clinical trial search/deltas | https://x402-trialscope.onrender.com | $0.01–$0.02/call |
| DocExtract — PDF → structured JSON | https://x402-docextract.onrender.com | ≤$0.10/doc |
| PatentScope — patent search/prior-art | https://x402-patentscope.onrender.com | $0.02–$0.05/call |
| Alexandria — auto parts intelligence | https://x402-alexandria.onrender.com | $0.02–$0.05/call |

Each service also serves `/llms.txt`, `/openapi.json`, and `/.well-known/x402`.
