function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function round(val, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((Number(val) || 0) * factor) / factor;
}

export function analyzeWashTrade(pair, rpcStats = {}) {
  const buysM5 = Number(pair?.txns?.m5?.buys || 0);
  const sellsM5 = Number(pair?.txns?.m5?.sells || 0);
  const buysH1 = Number(pair?.txns?.h1?.buys || 0);
  const sellsH1 = Number(pair?.txns?.h1?.sells || 0);
  const totalTxM5 = buysM5 + sellsM5;
  const totalTxH1 = buysH1 + sellsH1;

  const volM5 = Number(pair?.volume?.m5 || 0);
  const volH1 = Number(pair?.volume?.h1 || 0);
  const volH24 = Number(pair?.volume?.h24 || 0);
  const liqUsd = Math.max(1, Number(pair?.liquidity?.usd || 0));

  const priceChangeM5 = Number(pair?.priceChange?.m5 || 0);
  const priceChangeH1 = Number(pair?.priceChange?.h1 || 0);

  const volToLiqH1 = volH1 / liqUsd;
  const volToLiqM5 = volM5 / liqUsd;
  const volToLiqH24 = volH24 / liqUsd;

  const symmetryM5 =
    totalTxM5 >= 4 ? Math.min(buysM5, sellsM5) / Math.max(1, Math.max(buysM5, sellsM5)) : 0.5;
  const symmetryH1 =
    totalTxH1 >= 8 ? Math.min(buysH1, sellsH1) / Math.max(1, Math.max(buysH1, sellsH1)) : 0.5;

  const avgTradeM5 = totalTxM5 > 0 ? volM5 / totalTxM5 : 0;
  const avgTradeH1 = totalTxH1 > 0 ? volH1 / totalTxH1 : 0;

  // Repetitive size anomaly: when 5m average ticket size is suspiciously identical to 1h average
  // while churning high volume with minimal net price impact.
  let repetitiveSizeAnomaly = 0;
  if (avgTradeM5 > 0 && avgTradeH1 > 0) {
    const sizeRatioDiff = Math.abs(avgTradeM5 - avgTradeH1) / Math.max(avgTradeM5, avgTradeH1);
    if (sizeRatioDiff < 0.12 && totalTxM5 >= 6) {
      repetitiveSizeAnomaly = round((1 - sizeRatioDiff / 0.12) * 100, 1);
    } else if (sizeRatioDiff < 0.25 && totalTxH1 >= 20) {
      repetitiveSizeAnomaly = round((1 - sizeRatioDiff / 0.25) * 55, 1);
    }
  }

  let score = 100;
  const flags = [];

  // 1. Volume-to-Liquidity churn penalty
  if (volToLiqH1 > 3.0) {
    score -= 32;
    flags.push(`EXTREME_1H_VOL_LIQ_CHURN (${round(volToLiqH1, 2)}x)`);
  } else if (volToLiqH1 > 1.2) {
    score -= 20;
    flags.push(`ELEVATED_1H_VOL_LIQ_RATIO (${round(volToLiqH1, 2)}x)`);
  } else if (volToLiqH24 > 50.0) {
    score -= 44;
    flags.push(`EXTREME_24H_LIQUIDITY_CHURN (${round(volToLiqH24, 2)}x)`);
  } else if (volToLiqH24 > 8.0) {
    score -= 22;
    flags.push(`HIGH_24H_TURNOVER (${round(volToLiqH24, 2)}x)`);
  }

  // 2. Ping-pong buy/sell symmetry with flat price action (classic wash bot signature)
  if (symmetryH1 >= 0.85 && totalTxH1 >= 20 && Math.abs(priceChangeH1) < 3.5) {
    score -= 26;
    flags.push(`SYMMETRIC_PING_PONG_1H (symmetry=${round(symmetryH1, 2)}, delta=${round(priceChangeH1, 2)}%)`);
  } else if (symmetryM5 >= 0.85 && totalTxM5 >= 8 && Math.abs(priceChangeM5) < 1.5) {
    score -= 22;
    flags.push(`SYMMETRIC_PING_PONG_5M (symmetry=${round(symmetryM5, 2)}, delta=${round(priceChangeM5, 2)}%)`);
  }

  // 3. Repetitive trade size anomaly
  if (repetitiveSizeAnomaly >= 60) {
    score -= 20;
    flags.push(`REPETITIVE_BOT_TICKET_SIZE (anomaly=${repetitiveSizeAnomaly}/100)`);
  } else if (repetitiveSizeAnomaly >= 35) {
    score -= 10;
    flags.push(`MODERATE_TICKET_UNIFORMITY (anomaly=${repetitiveSizeAnomaly}/100)`);
  }

  // 4. Thin liquidity spoof risk
  if (liqUsd < 25_000 && volH1 > 10_000) {
    score -= 18;
    flags.push(`THIN_LIQUIDITY_PUMP_SPOOF (liq=$${round(liqUsd, 0)})`);
  }

  // 5. Base RPC on-chain actor concentration check
  if (rpcStats.onChainLogCount >= 10 && rpcStats.uniqueActorTopicCount > 0) {
    const actorRatio = rpcStats.uniqueActorTopicCount / rpcStats.onChainLogCount;
    if (actorRatio < 0.25) {
      score -= 15;
      flags.push(`CONCENTRATED_ONCHAIN_ACTORS (${rpcStats.uniqueActorTopicCount} actors / ${rpcStats.onChainLogCount} logs)`);
    }
  }

  const organicVolumeScore = Math.round(clamp(score, 0, 100));
  const verdict = organicVolumeScore >= 60 ? 'ORGANIC_DEMAND' : 'BOT_WASH_TRAP';

  return {
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    symbol: `${pair.baseToken?.symbol || 'UNKNOWN'}/${pair.quoteToken?.symbol || 'USD'}`,
    baseTokenAddress: pair.baseToken?.address || null,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    organicVolumeScore,
    verdict,
    confidence: organicVolumeScore <= 35 || organicVolumeScore >= 80 ? 'HIGH' : 'MEDIUM',
    metrics: {
      txnsM5: { buys: buysM5, sells: sellsM5, total: totalTxM5 },
      txnsH1: { buys: buysH1, sells: sellsH1, total: totalTxH1 },
      volumeUsd: { m5: round(volM5, 2), h1: round(volH1, 2), h24: round(volH24, 2) },
      liquidityUsd: round(liqUsd, 2),
      volumeToLiquidityRatio: { m5: round(volToLiqM5, 4), h1: round(volToLiqH1, 4), h24: round(volToLiqH24, 2) },
      buySellSymmetry: { m5: round(symmetryM5, 3), h1: round(symmetryH1, 3) },
      avgTradeSizeUsd: { m5: round(avgTradeM5, 2), h1: round(avgTradeH1, 2) },
      repetitiveSizeAnomaly,
      priceChangePct: { m5: round(priceChangeM5, 2), h1: round(priceChangeH1, 2) },
    },
    onChainVerification: rpcStats,
    riskFlags: flags.length > 0 ? flags : ['NO_WASH_ANOMALIES_DETECTED'],
    sniperAction:
      verdict === 'BOT_WASH_TRAP'
        ? 'ABORT_ENTRY — Artificial volume spoofing detected; do not chase.'
        : 'CLEAR_TO_EVALUATE — Order flow appears organic across Base DEX logs.',
  };
}

export function analyzeSmartMoneyVelocity(pair, rpcStats = {}) {
  const buysM5 = Number(pair?.txns?.m5?.buys || 0);
  const sellsM5 = Number(pair?.txns?.m5?.sells || 0);
  const buysH1 = Number(pair?.txns?.h1?.buys || 0);
  const sellsH1 = Number(pair?.txns?.h1?.sells || 0);

  const volM5 = Number(pair?.volume?.m5 || 0);
  const volH1 = Number(pair?.volume?.h1 || 0);
  const liqUsd = Math.max(1, Number(pair?.liquidity?.usd || 0));

  const priceM5 = Number(pair?.priceChange?.m5 || 0);
  const priceH1 = Number(pair?.priceChange?.h1 || 0);
  const priceH6 = Number(pair?.priceChange?.h6 || 0);
  const priceH24 = Number(pair?.priceChange?.h24 || 0);

  const buySellRatioM5 = buysM5 / Math.max(1, sellsM5);
  const buySellRatioH1 = buysH1 / Math.max(1, sellsH1);
  const pressureAcceleration = buySellRatioM5 / Math.max(0.1, buySellRatioH1);

  const totalTxM5 = Math.max(1, buysM5 + sellsM5);
  const netBuyImbalanceM5 = (buysM5 - sellsM5) / totalTxM5;
  const whaleNetInflowUsdPerMin = (netBuyImbalanceM5 * volM5) / 5;
  const avgTicketSizeUsd = volM5 / totalTxM5;

  // Volume run-rate acceleration: 5m annualized rate vs 1h average 5m slice
  const avgVolPer5mInH1 = Math.max(1, volH1 / 12);
  const volumeVelocityMultiple = volM5 / avgVolPer5mInH1;

  // Exhaustion score (0-100)
  let exhaustionIndex = 30;
  if (priceH1 > 20) exhaustionIndex += 25;
  else if (priceH1 > 10) exhaustionIndex += 12;
  if (priceH6 > 45) exhaustionIndex += 18;
  if (priceM5 < -1.5 && priceH1 > 8) exhaustionIndex += 22;
  if (buySellRatioM5 < 0.75 && priceH1 > 5) exhaustionIndex += 18;
  if (volumeVelocityMultiple < 0.5 && priceH1 > 10) exhaustionIndex += 12;
  if (pressureAcceleration > 1.25 && whaleNetInflowUsdPerMin > 0) exhaustionIndex -= 15;
  exhaustionIndex = Math.round(clamp(exhaustionIndex, 0, 100));

  let verdict = 'HOLD_TREND';
  if (exhaustionIndex >= 70 || (priceH1 > 15 && whaleNetInflowUsdPerMin < 0)) {
    verdict = 'TAKE_PROFIT_EXHAUSTION';
  } else if (
    pressureAcceleration >= 1.15 &&
    whaleNetInflowUsdPerMin > 250 &&
    exhaustionIndex < 65
  ) {
    verdict = 'ENTER_MOMENTUM';
  }

  return {
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    symbol: `${pair.baseToken?.symbol || 'UNKNOWN'}/${pair.quoteToken?.symbol || 'USD'}`,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    verdict,
    exhaustionIndex,
    metrics: {
      buySellRatioM5: round(buySellRatioM5, 3),
      buySellRatioH1: round(buySellRatioH1, 3),
      pressureAcceleration: round(pressureAcceleration, 3),
      whaleNetInflowUsdPerMin: round(whaleNetInflowUsdPerMin, 2),
      avgTicketSizeUsd: round(avgTicketSizeUsd, 2),
      volumeVelocityMultiple: round(volumeVelocityMultiple, 2),
      liquidityUsd: round(liqUsd, 2),
      priceChangePct: {
        m5: round(priceM5, 2),
        h1: round(priceH1, 2),
        h6: round(priceH6, 2),
        h24: round(priceH24, 2),
      },
    },
    onChainVerification: rpcStats,
    executionGuidance:
      verdict === 'ENTER_MOMENTUM'
        ? 'Smart-money inflow accelerating with low exhaustion; favorable momentum entry.'
        : verdict === 'TAKE_PROFIT_EXHAUSTION'
          ? 'Buy-side velocity decelerating into extended price action; scale out or tighten stops.'
          : 'Balanced order flow; maintain existing position and monitor next 5m acceleration.',
  };
}

export function analyzeLpImpermanentLoss(pair, { feeBpsOverride = null, clMultiplier = 3.0 } = {}) {
  const dexId = (pair?.dexId || 'uniswap').toLowerCase();
  const labels = Array.isArray(pair?.labels) ? pair.labels.map((l) => String(l).toLowerCase()) : [];
  const isConcentrated = labels.includes('v3') || labels.includes('cl') || dexId.includes('uniswap') || dexId.includes('aerodrome');

  const inferredFeeBps =
    feeBpsOverride != null && !Number.isNaN(Number(feeBpsOverride))
      ? Number(feeBpsOverride)
      : dexId.includes('aerodrome')
        ? 5
        : 30;

  const volH24 = Number(pair?.volume?.h24 || 0);
  const liqUsd = Math.max(1, Number(pair?.liquidity?.usd || 0));
  const priceChangeH24 = Number(pair?.priceChange?.h24 || 0);
  const priceChangeH6 = Number(pair?.priceChange?.h6 || 0);
  const priceChangeH1 = Number(pair?.priceChange?.h1 || 0);

  const dailyFeesUsd = volH24 * (inferredFeeBps / 10_000);
  const dailyFeeYieldPct = (dailyFeesUsd / liqUsd) * 100;
  const estimatedFeeAprPct = dailyFeeYieldPct * 365;

  // Exact constant-product AMM IL formula: IL(k) = 2*sqrt(k)/(1+k) - 1
  const k = Math.max(0.05, 1 + priceChangeH24 / 100);
  const baseIl24hPct = Math.abs((2 * Math.sqrt(k)) / (1 + k) - 1) * 100;
  const rangeFactor = isConcentrated ? clMultiplier : 1.0;
  const effectiveIl24hPct = baseIl24hPct * rangeFactor;

  // Volatility divergence index (annualized realized volatility proxy from 1h/6h/24h moves)
  const compositeMovePct = Math.max(
    Math.abs(priceChangeH24),
    Math.abs(priceChangeH6) * 2,
    Math.abs(priceChangeH1) * 4.5
  );
  const estimatedIlAprDragPct = effectiveIl24hPct * 180; // conservative 180-day volatility drag
  const netYieldAprPct = estimatedFeeAprPct - estimatedIlAprDragPct;

  const feeToIlRatio = effectiveIl24hPct > 0.0001 ? dailyFeeYieldPct / effectiveIl24hPct : 99;
  const verdict =
    netYieldAprPct > 0 && feeToIlRatio >= 0.85 && compositeMovePct < 25
      ? 'FARM_FEES'
      : 'EXIT_LP_NOW';

  return {
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    poolType: isConcentrated ? 'CONCENTRATED_LIQUIDITY' : 'FULL_RANGE_AMM',
    symbol: `${pair.baseToken?.symbol || 'UNKNOWN'}/${pair.quoteToken?.symbol || 'USD'}`,
    priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
    verdict,
    metrics: {
      feeTierBps: inferredFeeBps,
      liquidityUsd: round(liqUsd, 2),
      volume24hUsd: round(volH24, 2),
      dailyFeeYieldPct: round(dailyFeeYieldPct, 4),
      estimatedFeeAprPct: round(estimatedFeeAprPct, 2),
      priceDivergence24hPct: round(priceChangeH24, 2),
      compositeVolatilityPct: round(compositeMovePct, 2),
      baseAmmIl24hPct: round(baseIl24hPct, 4),
      effectiveClIl24hPct: round(effectiveIl24hPct, 4),
      feeToIlCoverageRatio: round(feeToIlRatio, 2),
      netLpYieldAprPct: round(netYieldAprPct, 2),
    },
    rebalanceGuidance:
      verdict === 'FARM_FEES'
        ? 'Fee APR comfortably outpaces realized impermanent loss; stay in range and compound.'
        : 'Price volatility divergence is eroding LP principal faster than fee accrual; withdraw or widen ticks immediately.',
  };
}
