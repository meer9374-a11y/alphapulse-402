import { baseRpcCall } from './x402.js';

const UPSTREAM_CACHE = new Map();
const CACHE_TTL_MS = 15_000;

function getCached(key) {
  const entry = UPSTREAM_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL_MS) {
    UPSTREAM_CACHE.delete(key);
    return null;
  }
  return entry.data;
}

function setCached(key, data) {
  if (UPSTREAM_CACHE.size > 200) {
    const oldestKey = UPSTREAM_CACHE.keys().next().value;
    UPSTREAM_CACHE.delete(oldestKey);
  }
  UPSTREAM_CACHE.set(key, { ts: Date.now(), data });
}

async function fetchJson(url, timeoutMs = 4500) {
  const cached = getCached(url);
  if (cached) return { data: cached, cacheHit: true };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'AlphaPulse-402/1.0' },
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`Upstream HTTP ${res.status} for ${url}`);
    const data = await res.json();
    setCached(url, data);
    return { data, cacheHit: false };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export async function fetchBasePair({ pair, token, searchQuery = 'WETH USDC base' } = {}) {
  if (pair && /^0x[a-fA-F0-9]{40}$/.test(pair)) {
    const { data, cacheHit } = await fetchJson(`https://api.dexscreener.com/latest/dex/pairs/base/${pair}`);
    const found = data?.pair || (Array.isArray(data?.pairs) ? data.pairs[0] : null);
    if (found) return { pair: found, cacheHit };
  }

  if (token && /^0x[a-fA-F0-9]{40}$/.test(token)) {
    const { data, cacheHit } = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${token}`);
    const basePairs = (data?.pairs || []).filter((p) => p.chainId === 'base');
    if (basePairs.length > 0) {
      basePairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      return { pair: basePairs[0], cacheHit };
    }
  }

  const { data, cacheHit } = await fetchJson(
    `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(searchQuery)}`
  );
  const basePairs = (data?.pairs || []).filter((p) => p.chainId === 'base' && (p.liquidity?.usd || 0) > 10000);
  if (basePairs.length === 0) {
    throw new Error('No active Base DEX pairs returned by DexScreener');
  }
  basePairs.sort((a, b) => (b.volume?.h24 || 0) - (a.volume?.h24 || 0));
  return { pair: basePairs[0], pairs: basePairs, cacheHit };
}

export async function fetchActiveBasePools(queries = ['base memecoin', 'aerodrome base', 'uniswap base']) {
  const allPairs = [];
  const seen = new Set();
  for (const q of queries) {
    try {
      const { data } = await fetchJson(
        `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`
      );
      for (const p of data?.pairs || []) {
        if (p.chainId !== 'base') continue;
        if (!p.pairAddress || seen.has(p.pairAddress.toLowerCase())) continue;
        if ((p.volume?.h1 || 0) <= 0 && (p.volume?.h24 || 0) <= 0) continue;
        seen.add(p.pairAddress.toLowerCase());
        allPairs.push(p);
      }
    } catch {
      // continue to next query
    }
  }
  return allPairs;
}

export async function fetchBaseRpcPoolLogStats(pairAddress) {
  const cacheKey = `rpc_logs:${(pairAddress || '').toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return { ...cached, cacheHit: true };

  try {
    const blockNumCall = await baseRpcCall('eth_blockNumber', [], 3000);
    const latestBlock = parseInt(blockNumCall.result, 16);
    const fromBlock = '0x' + Math.max(0, latestBlock - 5).toString(16);
    const toBlock = '0x' + latestBlock.toString(16);

    let logs = [];
    if (pairAddress && /^0x[a-fA-F0-9]{40}$/.test(pairAddress)) {
      const logsCall = await baseRpcCall(
        'eth_getLogs',
        [{ address: pairAddress, fromBlock, toBlock }],
        3500
      );
      logs = Array.isArray(logsCall.result) ? logsCall.result : [];
    }

    const uniqueTxHashes = new Set(logs.map((l) => l.transactionHash).filter(Boolean));
    const uniqueTopic1 = new Set(logs.map((l) => l.topics?.[1]).filter(Boolean));
    const stats = {
      latestBlock,
      blocksScanned: 5,
      onChainLogCount: logs.length,
      uniqueTxCount: uniqueTxHashes.size,
      uniqueActorTopicCount: uniqueTopic1.size,
      logsPerTx: uniqueTxHashes.size > 0 ? Number((logs.length / uniqueTxHashes.size).toFixed(2)) : 0,
      rpcUsed: blockNumCall.rpcUrl,
      rpcLatencyMs: blockNumCall.latencyMs,
    };
    setCached(cacheKey, stats);
    return { ...stats, cacheHit: false };
  } catch (err) {
    return {
      latestBlock: null,
      blocksScanned: 0,
      onChainLogCount: 0,
      uniqueTxCount: 0,
      uniqueActorTopicCount: 0,
      logsPerTx: 0,
      rpcError: err.message,
      cacheHit: false,
    };
  }
}
