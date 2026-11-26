"""
AlphaPulse-402 ??Python x402 Payment Wrapper for LangChain / AutoGPT Quant Bots

Zero-dependency standard library + optional web3.py payment hook for calling
AlphaPulse-402 ($0.004-$0.005 USDC on Base L2) directly from Python agents.
"""

import json
import urllib.parse
import urllib.request
from typing import Callable, Optional

ALPHAPULSE_URL = "https://alphapulse-402.vercel.app"
PAY_TO = "0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7"
USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"


def call_alphapulse(
    endpoint: str,
    pair: Optional[str] = None,
    token: Optional[str] = None,
    pay_usdc_callback: Optional[Callable[[str, str, int], str]] = None,
    demo: bool = False,
) -> dict:
    """
    Calls an AlphaPulse-402 endpoint with automatic x402 negotiation.
    If `pay_usdc_callback(usdc_contract, pay_to, base_units) -> tx_hash` is provided,
    it automatically settles the $0.004-$0.005 USDC invoice on Base and retries.
    """
    params = {}
    if pair:
        params["pair"] = pair
    if token:
        params["token"] = token
    if demo:
        params["demo"] = "true"

    qs = urllib.parse.urlencode(params)
    url = f"{ALPHAPULSE_URL}{endpoint}" + (f"?{qs}" if qs else "")

    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        if exc.code != 402:
            raise
        invoice = json.loads(exc.read().decode("utf-8"))
        if not pay_usdc_callback:
            return {"status": 402, "invoice": invoice}

        tx_hash = pay_usdc_callback(
            invoice.get("asset", USDC_BASE),
            invoice.get("payTo", PAY_TO),
            int(invoice["maxAmountRequired"]),
        )
        paid_req = urllib.request.Request(
            url,
            headers={"Accept": "application/json", "X-Payment-Tx": tx_hash},
        )
        with urllib.request.urlopen(paid_req, timeout=15) as paid_resp:
            return json.loads(paid_resp.read().decode("utf-8"))


if __name__ == "__main__":
    # Instant zero-cost demo preview
    result = call_alphapulse("/api/v1/wash-trade-detector", demo=True)
    print(json.dumps(result, indent=2))
