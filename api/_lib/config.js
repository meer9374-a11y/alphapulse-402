export const CONFIG = {
  serviceName: 'AlphaPulse-402',
  version: '1.0.0',
  baseUrl: 'https://alphapulse-402.vercel.app',
  payTo: '0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7',
  network: 'base',
  chainId: 8453,
  usdcContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  usdcDecimals: 6,
  transferTopic: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  rpcUrls: [
    'https://mainnet.base.org',
    'https://base.llamarpc.com',
  ],
  antiReplayWindowSec: 600,
  pricing: {
    '/api/v1/wash-trade-detector': {
      toolName: 'detect_wash_trading',
      usdc: '0.004',
      baseUnits: '4000',
      description: 'Real-time Base DEX anti-spoofing & wash-trade detection filter returning organicVolumeScore (0-100) and ORGANIC_DEMAND vs BOT_WASH_TRAP verdict.',
    },
    '/api/v1/smart-money-velocity': {
      toolName: 'measure_smart_money_velocity',
      usdc: '0.005',
      baseUnits: '5000',
      description: 'Real-time 5m/1h buy-to-sell pressure acceleration, whale net inflow velocity, and momentum exhaustion radar returning ENTER_MOMENTUM, HOLD_TREND, or TAKE_PROFIT_EXHAUSTION.',
    },
    '/api/v1/lp-impermanent-loss-guard': {
      toolName: 'guard_lp_impermanent_loss',
      usdc: '0.004',
      baseUnits: '4000',
      description: 'Live fee-APR vs price-volatility divergence & impermanent loss shield for Aerodrome and Uniswap V3 pools on Base returning FARM_FEES vs EXIT_LP_NOW.',
    },
  },
  bootTimeMs: Date.now(),
};
