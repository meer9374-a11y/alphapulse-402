import { CONFIG } from './_lib/config.js';
import { setCorsHeaders, verifyBaseUsdcPayment, buildPaymentRequiredPayload } from './_lib/x402.js';
import { fetchActiveBasePools, fetchBasePair, fetchBaseRpcPoolLogStats } from './_lib/dex.js';
import { analyzeWashTrade, analyzeSmartMoneyVelocity, analyzeLpImpermanentLoss } from './_lib/quant.js';

const MCP_PROTOCOL_VERSION = '2024-11-05';

const TOOLS = [
  {
    name: 'detect_wash_trading',
    description:
      'Base DEX anti-spoofing & wash-trade filter ($0.004 USDC on Base). Computes organicVolumeScore (0-100) from DexScreener + Base RPC logs and returns ORGANIC_DEMAND vs BOT_WASH_TRAP. Pass demo:true for free edge-cached preview or payment_tx for live verified execution.',
    inputSchema: {
      type: 'object',
      properties: {
        pair: { type: 'string', description: 'Base DEX pair contract address (0x...)' },
        token: { type: 'string', description: 'Base ERC-20 token contract address (0x...)' },
        payment_tx: { type: 'string', description: 'Base Mainnet USDC transfer tx hash (>= 0.004 USDC to payTo)' },
        demo: { type: 'boolean', description: 'Set true for free edge-cached preview' },
      },
    },
  },
  {
    name: 'measure_smart_money_velocity',
    description:
      'Real-time 5m/1h buy-to-sell pressure acceleration & whale net inflow velocity radar on Base ($0.005 USDC). Returns ENTER_MOMENTUM, HOLD_TREND, or TAKE_PROFIT_EXHAUSTION.',
    inputSchema: {
      type: 'object',
      properties: {
        pair: { type: 'string', description: 'Base DEX pair contract address (0x...)' },
        token: { type: 'string', description: 'Base ERC-20 token contract address (0x...)' },
        payment_tx: { type: 'string', description: 'Base Mainnet USDC transfer tx hash (>= 0.005 USDC to payTo)' },
        demo: { type: 'boolean', description: 'Set true for free edge-cached preview' },
      },
    },
  },
  {
    name: 'guard_lp_impermanent_loss',
    description:
      'Automated LP Rebalance Shield for Aerodrome & Uniswap V3 pools on Base ($0.004 USDC). Compares live fee-APR vs volatility-driven impermanent loss and returns FARM_FEES vs EXIT_LP_NOW.',
    inputSchema: {
      type: 'object',
      properties: {
        pair: { type: 'string', description: 'Base LP pair contract address (0x...)' },
        token: { type: 'string', description: 'Base ERC-20 token contract address (0x...)' },
        fee_bps: { type: 'number', description: 'Optional pool fee tier in bps (e.g. 5 or 30)' },
        payment_tx: { type: 'string', description: 'Base Mainnet USDC transfer tx hash (>= 0.004 USDC to payTo)' },
        demo: { type: 'boolean', description: 'Set true for free edge-cached preview' },
      },
    },
  },
];

const TOOL_TO_ENDPOINT = {
  detect_wash_trading: '/api/v1/wash-trade-detector',
  measure_smart_money_velocity: '/api/v1/smart-money-velocity',
  guard_lp_impermanent_loss: '/api/v1/lp-impermanent-loss-guard',
};

function rpcResult(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } };
}

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({
      name: CONFIG.serviceName,
      version: CONFIG.version,
      protocol: 'MCP JSON-RPC 2.0',
      protocolVersion: MCP_PROTOCOL_VERSION,
      transport: 'streamable-http',
      endpoint: `${CONFIG.baseUrl}/mcp`,
      payTo: CONFIG.payTo,
      network: CONFIG.network,
      asset: CONFIG.usdcContract,
      tools: TOOLS.map((t) => ({
        name: t.name,
        priceUsdc: CONFIG.pricing[TOOL_TO_ENDPOINT[t.name]].usdc,
      })),
    });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed. Use POST for MCP JSON-RPC 2.0.' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      return res.status(400).json(rpcError(null, -32700, 'Parse error: invalid JSON'));
    }
  }

  if (!body || body.jsonrpc !== '2.0' || !body.method) {
    return res.status(400).json(rpcError(body?.id ?? null, -32600, 'Invalid Request: expected JSON-RPC 2.0 payload'));
  }

  const { id = null, method, params = {} } = body;

  if (method === 'initialize') {
    return res.status(200).json(
      rpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'alphapulse-402',
          version: CONFIG.version,
        },
      })
    );
  }

  if (method === 'notifications/initialized') {
    return res.status(202).end();
  }

  if (method === 'ping') {
    return res.status(200).json(rpcResult(id, {}));
  }

  if (method === 'tools/list') {
    return res.status(200).json(rpcResult(id, { tools: TOOLS }));
  }

  if (method === 'tools/call') {
    const toolName = params?.name;
    const args = params?.arguments || {};
    const endpoint = TOOL_TO_ENDPOINT[toolName];

    if (!endpoint) {
      return res.status(200).json(rpcError(id, -32602, `Unknown tool: ${toolName}`));
    }

    const spec = CONFIG.pricing[endpoint];
    const txHash = args.payment_tx || req.headers['x-payment-tx'] || req.headers['x-payment'] || null;
    const isDemo = args.demo === true || args.demo === 'true';

    let paymentInfo = null;
    if (txHash) {
      try {
        const verification = await verifyBaseUsdcPayment(String(txHash), spec.baseUnits);
        if (!verification.ok) {
          return res.status(200).json(
            rpcResult(id, {
              isError: true,
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(
                    {
                      status: 402,
                      ...buildPaymentRequiredPayload(endpoint, verification.reason),
                      verificationError: verification.code,
                    },
                    null,
                    2
                  ),
                },
              ],
            })
          );
        }
        paymentInfo = verification;
      } catch (err) {
        return res.status(200).json(
          rpcResult(id, {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
          })
        );
      }
    } else if (!isDemo) {
      return res.status(200).json(
        rpcResult(id, {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status: 402,
                  ...buildPaymentRequiredPayload(endpoint),
                },
                null,
                2
              ),
            },
          ],
        })
      );
    } else {
      paymentInfo = { demo: true, note: 'Free preview mode via MCP' };
    }

    try {
      let data;
      if (toolName === 'detect_wash_trading') {
        let targetPair = null;
        if (!args.pair && !args.token && isDemo) {
          const pools = await fetchActiveBasePools(['base meme', 'base pepe', 'aerodrome base']);
          if (pools.length > 0) {
            const scored = pools.map((p) => ({ pair: p, prelim: analyzeWashTrade(p) }));
            scored.sort((a, b) => a.prelim.organicVolumeScore - b.prelim.organicVolumeScore);
            targetPair = scored[0].pair;
          }
        }
        if (!targetPair) {
          const fetched = await fetchBasePair({ pair: args.pair, token: args.token, searchQuery: 'base meme' });
          targetPair = fetched.pair;
        }
        const rpcStats = await fetchBaseRpcPoolLogStats(targetPair.pairAddress);
        data = analyzeWashTrade(targetPair, rpcStats);
      } else if (toolName === 'measure_smart_money_velocity') {
        const { pair } = await fetchBasePair({ pair: args.pair, token: args.token, searchQuery: 'AERO WETH base' });
        const rpcStats = await fetchBaseRpcPoolLogStats(pair.pairAddress);
        data = analyzeSmartMoneyVelocity(pair, rpcStats);
      } else if (toolName === 'guard_lp_impermanent_loss') {
        const { pair } = await fetchBasePair({ pair: args.pair, token: args.token, searchQuery: 'WETH USDC aerodrome base' });
        data = analyzeLpImpermanentLoss(pair, { feeBpsOverride: args.fee_bps ?? null });
      }

      return res.status(200).json(
        rpcResult(id, {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  service: CONFIG.serviceName,
                  tool: toolName,
                  priceUsdc: spec.usdc,
                  payment: paymentInfo,
                  data,
                },
                null,
                2
              ),
            },
          ],
        })
      );
    } catch (err) {
      return res.status(200).json(
        rpcResult(id, {
          isError: true,
          content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
        })
      );
    }
  }

  return res.status(200).json(rpcError(id, -32601, `Method not found: ${method}`));
}
