import { CONFIG } from '../_lib/config.js';
import { enforceX402Gate } from '../_lib/x402.js';
import { fetchActiveBasePools, fetchBasePair, fetchBaseRpcPoolLogStats } from '../_lib/dex.js';
import { analyzeWashTrade } from '../_lib/quant.js';

const ENDPOINT = '/api/v1/wash-trade-detector';

export default async function handler(req, res) {
  const gate = await enforceX402Gate(req, res, ENDPOINT);
  if (gate.handled) return;

  try {
    const pairParam = req.query?.pair || null;
    const tokenParam = req.query?.token || null;

    let targetPair = null;
    let scanMeta = null;

    if (!pairParam && !tokenParam && gate.mode === 'demo') {
      // Live demo mode: scan active Base DEX pools (excluding major blue-chip stables/wrapped majors)
      // and surface the clearest BOT_WASH_TRAP
      const BLUE_CHIPS = new Set(['WETH', 'USDC', 'USDBC', 'CBBTC', 'CBETH', 'WSTETH', 'DAI', 'USDT']);
      const pools = await fetchActiveBasePools(['base meme', 'base pepe', 'base ai', 'aerodrome base']);
      const activePools = pools.filter(
        (p) =>
          !BLUE_CHIPS.has((p.baseToken?.symbol || '').toUpperCase()) &&
          (p.txns?.h1?.buys || 0) + (p.txns?.h1?.sells || 0) >= 10
      );
      const poolList = activePools.length > 0 ? activePools : pools;
      if (poolList.length > 0) {
        const scored = poolList.map((p) => ({ pair: p, prelim: analyzeWashTrade(p) }));
        scored.sort((a, b) => a.prelim.organicVolumeScore - b.prelim.organicVolumeScore);
        targetPair = scored[0].pair;
        scanMeta = {
          scannedBasePools: poolList.length,
          selectionReason: 'Auto-selected highest wash-trade risk live Base pool for demo proof',
        };
      }
    }

    if (!targetPair) {
      const fetched = await fetchBasePair({
        pair: pairParam,
        token: tokenParam,
        searchQuery: 'base meme',
      });
      targetPair = fetched.pair;
    }

    const rpcStats = await fetchBaseRpcPoolLogStats(targetPair.pairAddress);
    const analysis = analyzeWashTrade(targetPair, rpcStats);

    return res.status(200).json({
      service: CONFIG.serviceName,
      endpoint: ENDPOINT,
      priceUsdc: CONFIG.pricing[ENDPOINT].usdc,
      network: CONFIG.network,
      mode: gate.mode,
      timestamp: new Date().toISOString(),
      ...(scanMeta ? { demoScan: scanMeta } : {}),
      data: analysis,
      payment: gate.payment,
    });
  } catch (err) {
    return res.status(502).json({
      service: CONFIG.serviceName,
      endpoint: ENDPOINT,
      error: 'Upstream Base DEX data fetch failed',
      detail: err.message,
    });
  }
}
