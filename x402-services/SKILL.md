---
name: x402-services
description: Pay-per-call data APIs for AI agents over the x402 protocol (USDC on Base). Use when the agent needs government procurement search, SEC filing search, clinical trial data, PDF extraction, patent search, automotive parts intelligence, invoice extraction, sales-tax rates, or business verification — no API keys, pay per call from the agent's own wallet.
---

# x402 Pay-Per-Call Services

Nine live data APIs. Every priced route returns **HTTP 402** until paid via the
x402 protocol (EIP-3009 USDC authorization on Base mainnet, `eip155:8453`).
No API keys. No signup. The agent's wallet pays per call.

## Services

- **TenderWatch** `https://x402-tenderwatch.onrender.com` — Gov procurement search
  (EU TED + US SAM.gov) + 0–100 fit-scoring. `GET /search` $0.02,
  `GET /opportunity/{id}` $0.01, `POST /fit-score` $0.02.
- **EDGAR Lens** `https://x402-edgar-lens.onrender.com` — SEC filing full-text
  search, Item 1A/MD&A extraction, cited briefs. `GET /search` $0.02,
  `GET /filing/{cik}/{accession}/sections` $0.03, `GET /brief/{cik}/{accession}` $0.05.
- **TrialScope** `https://x402-trialscope.onrender.com` — ClinicalTrials.gov search,
  study dossiers, snapshots, change-deltas. `GET /search` $0.01,
  `GET /study/{nctId}` $0.01, `POST /snapshot` $0.01, `GET /delta` $0.02.
- **DocExtract** `https://x402-docextract.onrender.com` — PDF → structured JSON
  (invoices, contracts). `POST /extract` (multipart) ≤ $0.10/doc.
- **PatentScope** `https://x402-patentscope.onrender.com` — USPTO search, claim
  extraction, TF-IDF prior-art ranking. `GET /search` $0.03,
  `GET /patent/{number}` $0.02, `POST /prior-art` $0.05.
- **Alexandria** `https://x402-alexandria.onrender.com` — Auto parts intelligence
  (parts search, fitment, failure modes, demand). `GET /parts/search` $0.03,
  `GET /fitment/check` $0.05, `GET /failures` $0.02, `GET /demand` $0.02.
- **InvoiceIQ** `https://x402-invoiceiq.onrender.com` — AP invoice extraction:
  vendor, invoice number/dates, line items, subtotal/tax/total with arithmetic
  validation, duplicate detection, PO-match fields. `POST /extract` (multipart)
  $0.05/doc. Text-based PDFs only.
- **TaxRate US** `https://x402-taxrate.onrender.com` — State base sales-tax rate
  by ZIP/state (state granularity only; data vintage 2026-01) and economic-nexus
  filing thresholds. `GET /rate` $0.03, `GET /nexus` $0.01. Not tax advice.
- **EntityVerify** `https://x402-entityverify.onrender.com` — Business name
  verification against SEC-reporting public companies + official Secretary-of-
  State registry deep link. `GET /entity` $0.07. State registries not scraped.

Machine-readable specs: `/llms.txt`, `/openapi.json`, `/.well-known/x402` on
each service. Full payment walkthrough: `quickstart.md` in this folder.

## How to call (summary)

1. Request the endpoint → `402` with a base64 `payment-required` header.
   Decode it; `accepts[0]` has `scheme: "exact"`, `network: "eip155:8453"`,
   `amount` (USDC base units, 6 decimals), `asset` (Base USDC
   `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`), `payTo`, `maxTimeoutSeconds`.
2. Sign EIP-3009 `TransferWithAuthorization` for `amount` → `payTo`
   (domain: name "USD Coin", version "2", chainId 8453). Gasless — signing only.
3. Retry with `X-PAYMENT: base64({x402Version: 2, scheme: "exact",
   network: "eip155:8453", payload: {signature, authorization:
   {from, to, value, validAfter, validBefore, nonce}}})`.
4. `200` returns the data plus a `payment-response` header.

Amounts: `"20000"` = $0.02. `validBefore` must be within `maxTimeoutSeconds`
of now. Use a fresh random `nonce` per attempt — signatures are single-use.

Operated by Jebadiah. Upstream sources: SEC EDGAR, USPTO, ClinicalTrials.gov,
EU TED, US SAM.gov (public data, respected rate limits).
