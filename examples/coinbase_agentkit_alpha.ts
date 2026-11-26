/**
 * AlphaPulse-402 ??Coinbase AgentKit Pre-Entry Wash-Trade & Momentum Filter
 *
 * Automatically pays $0.004??0.005 USDC on Base L2 via x402 before your
 * autonomous trading agent enters a DEX swap, blocking BOT_WASH_TRAP pools.
 */

const ALPHAPULSE_BASE_URL = 'https://alphapulse-402.vercel.app';
const USDC_BASE_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const ALPHAPULSE_PAY_TO = '0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7';

export interface AgentKitWalletProvider {
  transferErc20: (params: {
    tokenAddress: string;
    to: string;
    amountBaseUnits: string;
  }) => Promise<{ txHash: string }>;
}

async function fetchWithX402<T>(
  endpoint: string,
  query: string,
  wallet: AgentKitWalletProvider
): Promise<T> {
  const url = `${ALPHAPULSE_BASE_URL}${endpoint}?${query}`;
  const probe = await fetch(url);

  if (probe.status !== 402) {
    if (!probe.ok) throw new Error(`AlphaPulse HTTP ${probe.status}`);
    return (await probe.json()) as T;
  }

  const invoice = await probe.json();
  const { txHash } = await wallet.transferErc20({
    tokenAddress: invoice.asset || USDC_BASE_ADDRESS,
    to: invoice.payTo || ALPHAPULSE_PAY_TO,
    amountBaseUnits: invoice.maxAmountRequired,
  });

  const paidRes = await fetch(url, {
    headers: { 'X-Payment-Tx': txHash },
  });
  if (!paidRes.ok) {
    throw new Error(`AlphaPulse verified call failed: HTTP ${paidRes.status}`);
  }
  return (await paidRes.json()) as T;
}

export async function shouldAgentEnterBasePool(
  pairAddress: string,
  wallet: AgentKitWalletProvider
): Promise<{ allowEntry: boolean; reason: string; wash: any; velocity?: any }> {
  // 1. Anti-Spoofing Filter ($0.004 USDC)
  const washRes: any = await fetchWithX402(
    '/api/v1/wash-trade-detector',
    `pair=${encodeURIComponent(pairAddress)}`,
    wallet
  );

  if (washRes.data.verdict === 'BOT_WASH_TRAP' || washRes.data.organicVolumeScore < 60) {
    return {
      allowEntry: false,
      reason: `Blocked by AlphaPulse-402: ${washRes.data.verdict} (score=${washRes.data.organicVolumeScore}/100)`,
      wash: washRes.data,
    };
  }

  // 2. Smart-Money Inflow Velocity Radar ($0.005 USDC)
  const velRes: any = await fetchWithX402(
    '/api/v1/smart-money-velocity',
    `pair=${encodeURIComponent(pairAddress)}`,
    wallet
  );

  const allowEntry = velRes.data.verdict === 'ENTER_MOMENTUM';
  return {
    allowEntry,
    reason: `WashScore=${washRes.data.organicVolumeScore}/100, Velocity=${velRes.data.verdict}`,
    wash: washRes.data,
    velocity: velRes.data,
  };
}
