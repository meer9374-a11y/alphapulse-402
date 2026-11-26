import { CONFIG } from '../_lib/config.js';
import { enforceX402Gate } from '../_lib/x402.js';
import { fetchBasePair } from '../_lib/dex.js';
import { analyzeLpImpermanentLoss } from '../_lib/quant.js';

const ENDPOINT = '/api/v1/lp-impermanent-loss-guard';

export default async function handler(req, res) {
  const gate = await enforceX402Gate(req, res, ENDPOINT);
  if (gate.handled) return;

  try {
    const pairParam = req.query?.pair || null;
    const tokenParam = req.query?.token || null;
    const feeBpsOverride = req.query?.feeBps ? Number(req.query.feeBps) : null;

    const { pair } = await fetchBasePair({
      pair: pairParam,
      token: tokenParam,
      searchQuery: 'WETH USDC aerodrome base',
    });

    const analysis = analyzeLpImpermanentLoss(pair, { feeBpsOverride });

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
      error: 'Upstream Base LP data fetch failed',
      detail: err.message,
    });
  }
}
