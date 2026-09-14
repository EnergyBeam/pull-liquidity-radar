# PULL — Liquidity Radar

Active liquidity research dashboard. Default profile: $200, 1 hour; supported horizons: 15 minutes, 1 hour, 4 hours.

Features: live trending/new pools on Solana, Robinhood, BSC and Base; token-address lookup; local favorites; five-minute price/volume charts; transparent rule-based ranking; 58 historical observations and nearest historical examples; user-supplied fee scenarios.

This is an initial research model, not a validated profit predictor. Historical price returns are not LP returns. Pool TVL is not active concentrated liquidity. Fee scenarios require an effective LP fee and active liquidity share supplied by the user, exclude changes in position value and are not net PnL. Contract safety is not verified. Trending/new endpoints are a sample, not exhaustive network discovery. Public API limits can interrupt updates.

## Run

Node 22.13+, npm ci, npm run build. Production: npm start.
For normal development replace the development-only loopback transport in lib/market.ts with the production origins, or run the local market transport supplied in the original workspace. The loopback transport works around this machine's Node TLS connectivity issue; production uses verified HTTPS directly.

## Validation

node --test tests/engine.test.mjs — 10 passing tests.
node node_modules/typescript/bin/tsc --noEmit — passes.
npm run build — passes.
Live API smoke checks: BSC and Robinhood discovery, BSC 99 closed candles, stable cached observation timestamp and invalid-network HTTP 400.

npm run lint currently reports strict rules in generated UI components and application code; this check is not clean. Optional WebMCP integration is feature-detected, but no supporting browser context was available for integration testing.

Historical data contains token/pool addresses and market observations only. Private chat messages and participant names are not included. Favorites remain in this browser. Live refresh operates while the page is open and visible; local Telegram alerts are available through notifier/setup.py (see notifier/README.md). There is no wallet execution.


Volume monitoring: 5-minute volume >= $1,000 and >= 3x the preceding 55-minute average per 5 minutes. Fade means <=25% of an observed peak within one hour; missing or stale data is not a fade. The UI tracks observed API snapshots, the local monitor tracks its own observations in SQLite, so their detected peaks may differ. Surge Telegram alerts respect USDG, network and minimum TVL filters but do not require a high LP score. One surge episode is sent once, with a minimum 30-minute pause between surge messages for a pool. Capitalization uses market_cap_usd / marketCap; FDV is displayed separately and is never substituted for missing capitalization.
