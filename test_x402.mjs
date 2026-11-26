#!/usr/bin/env node
/**
 * AlphaPulse-402 Zero-Cost CLI Verification Suite
 * Tests:
 *  1. /api/v1/health live Base RPC latency & quota config
 *  2. HTTP 402 Payment Required contract on all 3 paid endpoints
 *  3. Invalid/simulated Base tx hash rejection via X-Payment-Tx
 *  4. Live ?demo=true quantitative scoring (wash-trade, velocity, LP guard)
 *  5. Remote MCP JSON-RPC 2.0 (initialize, tools/list, tools/call)
 *  6. Discovery manifests (/.well-known/x402.json, /.well-known/mcp.json, /llms.txt, /openapi.json)
 */

const BASE_URL = (process.argv[2] || process.env.ALPHAPULSE_URL || '<YOUR_VERCEL_URL>').replace(/\/$/, '');
const EXPECTED_PAY_TO = '0x6137ED1A93c8CFF1a6C3112A14bE04883f58E5F7';
const EXPECTED_USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

let passed = 0;
let failed = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    passed++;
    console.log(`  [PASS] ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function run() {
  console.log(`\n=== AlphaPulse-402 Verification Suite ===`);
  console.log(`Target: ${BASE_URL}\n`);

  // 1. Health check
  console.log('1. Checking /api/v1/health ...');
  const healthRes = await fetch(`${BASE_URL}/api/v1/health`);
  const health = await healthRes.json();
  assert(healthRes.status === 200, 'Health HTTP 200');
  assert(health.payTo === EXPECTED_PAY_TO, 'Health payTo matches wallet');
  assert(health.baseRpc?.status === 'healthy', 'Base Mainnet RPC healthy', `${health.baseRpc?.latencyMs}ms @ block ${health.baseRpc?.latestBlock}`);

  // 2. Unpaid 402 checks
  console.log('\n2. Checking HTTP 402 x402 invoices ...');
  const paidEndpoints = [
    { path: '/api/v1/wash-trade-detector', units: '4000' },
    { path: '/api/v1/smart-money-velocity', units: '5000' },
    { path: '/api/v1/lp-impermanent-loss-guard', units: '4000' },
  ];
  for (const ep of paidEndpoints) {
    const r = await fetch(`${BASE_URL}${ep.path}`);
    const body = await r.json();
    assert(r.status === 402, `${ep.path} returns 402`);
    assert(
      body.payTo === EXPECTED_PAY_TO && body.asset === EXPECTED_USDC && body.maxAmountRequired === ep.units,
      `${ep.path} invoice exact (${ep.units} base units)`
    );
  }

  // 3. Simulated Base tx hash verification check
  console.log('\n3. Checking X-Payment-Tx on-chain verification gate ...');
  const fakeTx = '0x' + '1'.repeat(64);
  const fakeRes = await fetch(`${BASE_URL}/api/v1/wash-trade-detector`, {
    headers: { 'X-Payment-Tx': fakeTx },
  });
  const fakeBody = await fakeRes.json();
  assert(fakeRes.status === 402, 'Unconfirmed/fake Base tx rejected with 402', fakeBody.verificationError);

  // 4. Live ?demo=true scoring
  console.log('\n4. Checking live ?demo=true quant endpoints ...');
  const washRes = await fetch(`${BASE_URL}/api/v1/wash-trade-detector?demo=true`);
  const wash = await washRes.json();
  assert(washRes.status === 200, 'wash-trade-detector demo HTTP 200');
  assert(
    typeof wash.data?.organicVolumeScore === 'number' &&
      ['ORGANIC_DEMAND', 'BOT_WASH_TRAP'].includes(wash.data?.verdict),
    'wash-trade-detector valid score & verdict',
    `${wash.data?.symbol} -> ${wash.data?.verdict} (${wash.data?.organicVolumeScore}/100)`
  );
  assert(
    (washRes.headers.get('cache-control') || '').includes('s-maxage=60'),
    'Demo enforces Vercel Hobby edge cache (s-maxage=60)'
  );

  const velRes = await fetch(`${BASE_URL}/api/v1/smart-money-velocity?demo=true`);
  const vel = await velRes.json();
  assert(velRes.status === 200, 'smart-money-velocity demo HTTP 200');
  assert(
    ['ENTER_MOMENTUM', 'HOLD_TREND', 'TAKE_PROFIT_EXHAUSTION'].includes(vel.data?.verdict),
    'smart-money-velocity valid verdict',
    `${vel.data?.symbol} -> ${vel.data?.verdict}`
  );

  const lpRes = await fetch(`${BASE_URL}/api/v1/lp-impermanent-loss-guard?demo=true`);
  const lp = await lpRes.json();
  assert(lpRes.status === 200, 'lp-impermanent-loss-guard demo HTTP 200');
  assert(
    ['FARM_FEES', 'EXIT_LP_NOW'].includes(lp.data?.verdict),
    'lp-impermanent-loss-guard valid verdict',
    `${lp.data?.symbol} -> ${lp.data?.verdict} (APR=${lp.data?.metrics?.estimatedFeeAprPct}%)`
  );

  // 5. Remote MCP JSON-RPC 2.0
  console.log('\n5. Checking Remote MCP JSON-RPC 2.0 (/mcp) ...');
  const mcpInit = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
  });
  const mcpInitJson = await mcpInit.json();
  assert(mcpInitJson.result?.protocolVersion === '2024-11-05', 'MCP initialize protocolVersion 2024-11-05');

  const mcpList = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
  });
  const mcpListJson = await mcpList.json();
  const toolNames = (mcpListJson.result?.tools || []).map((t) => t.name);
  assert(
    toolNames.includes('detect_wash_trading') &&
      toolNames.includes('measure_smart_money_velocity') &&
      toolNames.includes('guard_lp_impermanent_loss'),
    'MCP tools/list exposes all 3 quant tools',
    toolNames.join(', ')
  );

  const mcpCall = await fetch(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'detect_wash_trading', arguments: { demo: true } },
    }),
  });
  const mcpCallJson = await mcpCall.json();
  assert(Array.isArray(mcpCallJson.result?.content) && !mcpCallJson.result?.isError, 'MCP tools/call demo succeeds');

  // 6. Discovery manifests
  console.log('\n6. Checking discovery manifests ...');
  for (const path of ['/.well-known/x402.json', '/.well-known/mcp.json', '/llms.txt', '/openapi.json']) {
    const r = await fetch(`${BASE_URL}${path}`);
    assert(r.status === 200, `${path} HTTP 200`);
  }

  console.log(`\n=== Summary: ${passed} passed, ${failed} failed ===\n`);
  console.log('--- Sample Live Wash-Trade Detector Output ---');
  console.log(JSON.stringify(wash, null, 2));

  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
