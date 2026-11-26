import { CONFIG } from '../_lib/config.js';
import { baseRpcCall, setCorsHeaders } from '../_lib/x402.js';

export default async function handler(req, res) {
  setCorsHeaders(res);
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  res.setHeader('Cache-Control', 'public, s-maxage=15, stale-while-revalidate=30');

  let rpcStatus = 'degraded';
  let rpcLatencyMs = null;
  let latestBlock = null;
  let activeRpc = null;
  let rpcError = null;

  try {
    const blockCall = await baseRpcCall('eth_blockNumber', [], 3500);
    rpcStatus = 'healthy';
    rpcLatencyMs = blockCall.latencyMs;
    latestBlock = parseInt(blockCall.result, 16);
    activeRpc = blockCall.rpcUrl;
  } catch (err) {
    rpcError = err.message;
  }

  const uptimeSeconds = Math.floor((Date.now() - CONFIG.bootTimeMs) / 1000);

  return res.status(200).json({
    status: rpcStatus === 'healthy' ? 'ok' : 'degraded',
    service: CONFIG.serviceName,
    version: CONFIG.version,
    network: CONFIG.network,
    chainId: CONFIG.chainId,
    payTo: CONFIG.payTo,
    asset: CONFIG.usdcContract,
    uptimeSeconds,
    baseRpc: {
      status: rpcStatus,
      activeEndpoint: activeRpc,
      fallbackEndpoints: CONFIG.rpcUrls,
      latencyMs: rpcLatencyMs,
      latestBlock,
      ...(rpcError ? { error: rpcError } : {}),
    },
    pricingTable: Object.entries(CONFIG.pricing).map(([endpoint, spec]) => ({
      endpoint,
      mcpTool: spec.toolName,
      priceUsdc: spec.usdc,
      baseUnits: spec.baseUnits,
      description: spec.description,
    })),
    quotaProtection: {
      tier: 'Vercel Hobby-Optimized',
      demoEdgeCache: 'public, s-maxage=60, stale-while-revalidate=120',
      paidUpstreamEdgeCache: 'public, s-maxage=15, stale-while-revalidate=30',
      statelessAntiReplaySeconds: CONFIG.antiReplayWindowSec,
      zeroExternalDependencies: true,
    },
    timestamp: new Date().toISOString(),
  });
}
