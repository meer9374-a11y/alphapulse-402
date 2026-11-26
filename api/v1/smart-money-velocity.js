import { CONFIG } from '../_lib/config.js';
import { enforceX402Gate } from '../_lib/x402.js';
import { fetchBasePair, fetchBaseRpcPoolLogStats } from '../_lib/dex.js';
import { analyzeSmartMoneyVelocity } from '../_lib/quant.js';

const ENDPOINT = '/api/v1/smart-money-velocity';

export default async function handler(req, res) {
  const gate = await enforceX402Gate(req, res, ENDPOINT);
  if (gate.handled) return;

  try {
    const pairParam = req.query?.pair || null;
    const tokenParam = req.query?.token || null;

    const { pair } = await fetchBasePair({
      pair: pairParam,
      token: tokenParam,
      searchQuery: 'AERO WETH base',
    });

    const rpcStats = await fetchBaseRpcPoolLogStats(pair.pairAddress);
    const analysis = analyzeSmartMoneyVelocity(pair, rpcStats);

    return res.status(200).json({
      service: CONFIG.serviceName,
      endpoint: ENDPOINT,
      priceUsdc: CONFIG.pricing[ENDPOINT].usdc,
      network: CONFIG.network,
      mode: gate.mode,
      timestamp: new Date().toISOString(),
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
