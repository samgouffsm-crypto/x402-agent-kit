"""LangChain tool wrappers for Jebadiah's x402 pay-per-call services.

Each tool performs the x402 flow automatically: call -> 402 -> sign EIP-3009
USDC authorization -> retry with X-PAYMENT. The agent just calls the tool;
the wallet key comes from PAYER_KEY.

pip install langchain-core requests eth-account web3
"""
import base64
import json
import os
import secrets
import time

import requests
from eth_account import Account
from eth_account.messages import encode_typed_data
from langchain_core.tools import tool

USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
CHAIN_ID = 8453


def _paid_request(method, url, key=None, **kw):
    """Generic x402 paid request. Returns parsed JSON."""
    acct = Account.from_key(key or os.environ["PAYER_KEY"])
    r = requests.request(method, url, timeout=90, **kw)
    if r.status_code != 402:
        r.raise_for_status()
        return r.json()
    terms = json.loads(base64.b64decode(r.headers["payment-required"]))
    a = terms["accepts"][0]
    valid_before = str(int(time.time()) + a.get("maxTimeoutSeconds", 300))
    nonce = "0x" + secrets.token_bytes(32).hex()
    typed = {
        "types": {
            "EIP712Domain": [
                {"name": "name", "type": "string"},
                {"name": "version", "type": "string"},
                {"name": "chainId", "type": "uint256"},
                {"name": "verifyingContract", "type": "address"},
            ],
            "TransferWithAuthorization": [
                {"name": "from", "type": "address"},
                {"name": "to", "type": "address"},
                {"name": "value", "type": "uint256"},
                {"name": "validAfter", "type": "uint256"},
                {"name": "validBefore", "type": "uint256"},
                {"name": "nonce", "type": "bytes32"},
            ],
        },
        "primaryType": "TransferWithAuthorization",
        "domain": {
            "name": "USD Coin", "version": "2",
            "chainId": CHAIN_ID, "verifyingContract": USDC,
        },
        "message": {
            "from": acct.address, "to": a["payTo"], "value": int(a["amount"]),
            "validAfter": 0, "validBefore": int(valid_before),
            "nonce": bytes.fromhex(nonce[2:]),
        },
    }
    sig = "0x" + acct.sign_message(encode_typed_data(full_message=typed)).signature.hex()
    payload = {
        "x402Version": 2, "scheme": a["scheme"], "network": a["network"],
        "payload": {
            "signature": sig,
            "authorization": {
                "from": acct.address, "to": a["payTo"], "value": str(a["amount"]),
                "validAfter": "0", "validBefore": valid_before, "nonce": nonce,
            },
        },
    }
    headers = dict(kw.pop("headers", {}))
    headers["X-PAYMENT"] = base64.b64encode(json.dumps(payload).encode()).decode()
    r = requests.request(method, url, headers=headers, timeout=90, **kw)
    r.raise_for_status()
    return r.json()


@tool
def tenderwatch_search(q: str, source: str = "all", limit: int = 20) -> str:
    """Search open government procurement opportunities (EU TED + US SAM.gov).
    $0.02/call via x402. source: 'sam', 'ted', or 'all'."""
    data = _paid_request("GET", "https://x402-tenderwatch.onrender.com/search",
                         params={"q": q, "source": source, "limit": limit})
    return json.dumps(data)[:8000]


@tool
def edgar_search(q: str, forms: str = "10-K,10-Q,8-K", limit: int = 5) -> str:
    """Full-text search of SEC EDGAR filings. $0.02/call via x402."""
    data = _paid_request("GET", "https://x402-edgar-lens.onrender.com/search",
                         params={"q": q, "forms": forms, "limit": limit})
    return json.dumps(data)[:8000]


@tool
def trialscope_search(term: str, status: str = "RECRUITING", pageSize: int = 20) -> str:
    """Search ClinicalTrials.gov studies by term/status. $0.01/call via x402."""
    data = _paid_request("GET", "https://x402-trialscope.onrender.com/search",
                         params={"term": term, "status": status, "pageSize": pageSize})
    return json.dumps(data)[:8000]


@tool
def patentscope_search(q: str, limit: int = 10) -> str:
    """Keyword search of US patents. $0.03/call via x402."""
    data = _paid_request("GET", "https://x402-patentscope.onrender.com/search",
                         params={"q": q, "limit": limit})
    return json.dumps(data)[:8000]


@tool
def alexandria_parts_search(q: str, vehicle: str = "", symptom: str = "") -> str:
    """Search automotive parts research (parts, procedures, failure modes).
    $0.03/call via x402."""
    data = _paid_request("GET", "https://x402-alexandria.onrender.com/parts/search",
                         params={"q": q, "vehicle": vehicle, "symptom": symptom})
    return json.dumps(data)[:8000]


@tool
def docextract_pdf(pdf_path: str) -> str:
    """Extract structured JSON (line items, tables, totals, parties, dates)
    from a PDF invoice/statement/contract. Up to $0.10/doc via x402."""
    with open(pdf_path, "rb") as f:
        data = _paid_request("POST", "https://x402-docextract.onrender.com/extract",
                             files={"file": (os.path.basename(pdf_path), f, "application/pdf")})
    return json.dumps(data)[:12000]


ALL_TOOLS = [tenderwatch_search, edgar_search, trialscope_search,
             patentscope_search, alexandria_parts_search, docextract_pdf]
