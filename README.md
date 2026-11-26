# AlphaPulse-402

Ultra-Low-Cost Remote MCP & x402 Quantitative Alpha Node on Base ($0.004??0.005 USDC, Zero API Keys): Real-time DEX wash-trade detector, smart-money inflow velocity radar, and LP impermanent loss guard with ready-to-use Coinbase AgentKit, ElizaOS, and Claude/Cursor plugins.

[![License: MIT](https://img.shields.io/badge/License-MIT-10b981.svg)](LICENSE)
[![Network: Base L2](https://img.shields.io/badge/Network-Base%20Mainnet-0052ff.svg)](https://base.org)
[![Protocol: x402 + MCP](https://img.shields.io/badge/Protocol-x402%20%7C%20MCP%202024--11--05-a855f7.svg)](https://alphapulse-402.vercel.app/mcp)

---

## Why AlphaPulse-402?

Autonomous trading bots and sniper agents bleed capital on **fake DEX wash-trading pumps**, **late momentum entries**, and **unhedged concentrated LP impermanent loss**. Existing analytics APIs charge $49??499/mo or $0.01??0.05 per call and require API keys.

**AlphaPulse-402** runs on pure zero-dependency Node.js ES modules with **stateless Base Mainnet USDC verification**:
- **Undercut Micro-Pricing:** **$0.004??0.005 USDC** per call on Base L2 (up to 10x cheaper than competitors).
- **Zero API Keys / Zero Accounts:** Stream USDC directly to `0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7` and pass `X-Payment-Tx: <0x_tx_hash>`.
- **Stateless Anti-Replay:** Verifies `status === "0x1"`, USDC `Transfer` log amount, and block timestamp within the last `600s` directly against official Base Mainnet RPC (`https://mainnet.base.org`, fallback `https://base.llamarpc.com`).
- **Edge-Cached Quota Protection:** Free `?demo=true` previews are edge-cached (`s-maxage=60, stale-while-revalidate=120`); paid calls bypass demo throttling with 15s upstream DexScreener/RPC caching.

---

## Live Endpoints & Pricing

| Endpoint | MCP Tool | Price (Base USDC) | Base Units | Output Signal |
| :--- | :--- | :---: | :---: | :--- |
| `GET /api/v1/wash-trade-detector` | `detect_wash_trading` | **$0.004** | `4000` | `organicVolumeScore` (0??00) · `ORGANIC_DEMAND` vs `BOT_WASH_TRAP` |
| `GET /api/v1/smart-money-velocity` | `measure_smart_money_velocity` | **$0.005** | `5000` | `pressureAcceleration`, `whaleNetInflowUsdPerMin` · `ENTER_MOMENTUM` / `HOLD_TREND` / `TAKE_PROFIT_EXHAUSTION` |
| `GET /api/v1/lp-impermanent-loss-guard` | `guard_lp_impermanent_loss` | **$0.004** | `4000` | `estimatedFeeAprPct` vs `effectiveClIl24hPct` · `FARM_FEES` vs `EXIT_LP_NOW` |
| `GET /api/v1/health` | ??| **Free** | `0` | Live Base RPC latency, latest block, uptime, pricing & cache policy |
| `POST /mcp` | All 3 tools | **$0.004??0.005** | `4000`/`5000` | Remote MCP JSON-RPC 2.0 (`2024-11-05`) |

- **Live Base URL:** `https://alphapulse-402.vercel.app`
- **PayTo Wallet (Base Mainnet):** `0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7`
- **USDC Contract (Base):** `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`

---

## 1-Minute Plug-and-Play Integrations

### 1. Claude Desktop / Cursor / Windsurf (Remote MCP)

Add AlphaPulse-402 to your MCP config (`claude_desktop_config.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "alphapulse-402": {
      "url": "https://alphapulse-402.vercel.app/mcp",
      "transport": "http"
    }
  }
}
```

### 2. Coinbase AgentKit (Pre-Entry Wash-Trade & Momentum Filter)

See full TypeScript module: [`examples/coinbase_agentkit_alpha.ts`](examples/coinbase_agentkit_alpha.ts)

```ts
import { shouldAgentEnterBasePool } from './examples/coinbase_agentkit_alpha';

const decision = await shouldAgentEnterBasePool(pairAddress, agentKitWallet);
if (!decision.allowEntry) {
  console.log('Trade aborted:', decision.reason);
}
```

### 3. ElizaOS / ai16z Trading Agent Action

See full plugin action: [`examples/elizaos_alpha_action.ts`](examples/elizaos_alpha_action.ts)

```ts
import { alphaPulseWashCheckAction } from './examples/elizaos_alpha_action';
// Register inside your ElizaOS plugin actions array
```

### 4. LangChain / AutoGPT Python x402 Wrapper

See full Python client: [`examples/langchain_x402_alpha.py`](examples/langchain_x402_alpha.py)

```python
from examples.langchain_x402_alpha import call_alphapulse
signal = call_alphapulse("/api/v1/wash-trade-detector", demo=True)
print(signal["data"]["verdict"], signal["data"]["organicVolumeScore"])
```

---

## Discovery Manifests

- **x402 Manifest:** `https://alphapulse-402.vercel.app/.well-known/x402.json`
- **MCP Manifest:** `https://alphapulse-402.vercel.app/.well-known/mcp.json`
- **LLMs Index:** `https://alphapulse-402.vercel.app/llms.txt`
- **OpenAPI 3.1 Spec:** `https://alphapulse-402.vercel.app/openapi.json`

---

## Zero-Cost CLI Verification

Run the built-in test suite against the live deployment (zero external dependencies):

```bash
node test_x402.mjs https://alphapulse-402.vercel.app
```

---

## License

MIT License ??see [LICENSE](LICENSE).
