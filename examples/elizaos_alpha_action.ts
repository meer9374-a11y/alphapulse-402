/**
 * AlphaPulse-402 — ElizaOS (ai16z) Custom Alpha-Scoring Action Plugin
 *
 * Drop this Action into your ElizaOS character plugin to give your trading
 * agent real-time Base wash-trade detection and LP rebalance intelligence.
 */

const ALPHAPULSE_URL = '<YOUR_VERCEL_URL>';

export interface ElizaActionContext {
  pairAddress?: string;
  tokenAddress?: string;
  paymentTxHash?: string;
  demo?: boolean;
}

export const alphaPulseWashCheckAction = {
  name: 'ALPHAPULSE_WASH_CHECK',
  similes: ['CHECK_WASH_TRADING', 'VERIFY_BASE_POOL', 'SCAN_FAKE_VOLUME'],
  description:
    'Queries AlphaPulse-402 on Base ($0.004 USDC via x402 or ?demo=true) to score organic volume and flag BOT_WASH_TRAP pools before executing swaps.',

  validate: async (_runtime: unknown, message: { content?: { text?: string } }) => {
    const text = (message?.content?.text || '').toLowerCase();
    return text.includes('0x') || text.includes('wash') || text.includes('alpha') || text.includes('base');
  },

  handler: async (
    _runtime: unknown,
    message: { content?: { text?: string } },
    _state: unknown,
    options?: ElizaActionContext,
    callback?: (response: { text: string; data?: unknown }) => Promise<void>
  ) => {
    const match = (message?.content?.text || '').match(/0x[a-fA-F0-9]{40}/);
    const pair = options?.pairAddress || match?.[0] || '';
    const params = new URLSearchParams();
    if (pair) params.set('pair', pair);
    if (!options?.paymentTxHash) params.set('demo', 'true');

    const headers: Record<string, string> = {};
    if (options?.paymentTxHash) {
      headers['X-Payment-Tx'] = options.paymentTxHash;
    }

    const res = await fetch(`${ALPHAPULSE_URL}/api/v1/wash-trade-detector?${params.toString()}`, {
      headers,
    });
    const payload: any = await res.json();

    if (res.status === 402) {
      const msg = `AlphaPulse-402 requires ${payload.priceUsdc} USDC on Base to ${payload.payTo}. Retry with X-Payment-Tx.`;
      if (callback) await callback({ text: msg, data: payload });
      return false;
    }

    const d = payload.data;
    const summary = `[AlphaPulse-402] ${d.symbol} (${d.dexId}) -> Verdict: ${d.verdict} | Organic Score: ${d.organicVolumeScore}/100 | Action: ${d.sniperAction}`;
    if (callback) await callback({ text: summary, data: d });
    return true;
  },
};
