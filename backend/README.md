# Prediction Market Backend

Production-ready backend for a ion market platform (Polymarket-style).

## Architecture

```
src/
├── config/                  # Environment config with Zod validation
├── common/                  # Shared: errors, guards, middleware, logger
├── database/
│   ├── connection.ts        # Knex + transaction helpers
│   ├── migrations/          # Full schema with indexes
│   └── seeds/               # Dev seed data
├── infrastructure/
│   ├── redis/               # Cache service + distributed locking
│   ├── websocket/           # WS server + Redis pub/sub for scaling
│   ├── metrics/             # Prometheus instrumentation
│   └── jobs/                # Cron jobs (candles, expiry, cleanup)
└── modules/
    ├── auth/                # JWT + refresh tokens + brute-force protection
    ├── users/               # Profiles + activity
    ├── markets/             # CRUD + status management
    ├── trading/             # LMSR engine (core)
    ├── portfolio/           # Balances, positions, PnL
    ├── analytics/           # OHLCV candles, price lines, volume
    ├── activity/            # Event feed
    └── admin/               # Moderation + resolution
```

## Key Design Decisions

### Trading Engine: LMSR (Logarithmic Market Scoring Rule)
- Automated Market Maker — no counterparty needed
- Price = probability (0–1), always sums to 1
- Liquidity parameter `b` controls price sensitivity
- Numerical stability via log-sum-exp trick
- Binary search for share quantity calculation

### Consistency & Race Conditions
- `SELECT FOR UPDATE` on market rows during trades
- Optimistic locking (`version` column) on balances/positions
- All trade operations in atomic PostgreSQL transactions
- Redis distributed locks for cross-instance coordination

### Real-time
- WebSocket per market subscription model
- Redis pub/sub for horizontal scaling (multiple API instances)
- Heartbeat + automatic stale connection cleanup

### Analytics
- Raw `price_history` table written on every trade
- Pre-aggregated `price_candles` (OHLCV) via cron jobs
- Resolutions: 1m, 5m, 15m, 1h, 4h, 1d, 1w
- Falls back to raw aggregation if candles not yet built

## API Reference

### Auth
```
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me
```

### Markets
```
GET    /api/v1/markets                    # List with filters/search/pagination
GET    /api/v1/markets/:id                # Single market
POST   /api/v1/markets                    # Create (auth required)
PATCH  /api/v1/markets/:id                # Update (creator/admin)
GET    /api/v1/markets/:id/stats          # Volume, trades, liquidity
PATCH  /api/v1/markets/:id/status         # Pause/activate (moderator+)
```

### Trading
```
POST   /api/v1/trading/:marketId/quote    # Get price quote (no auth)
POST   /api/v1/trading/:marketId/trade    # Execute trade (auth required)
```

**Trade Request:**
```json
{
  "side": "yes",
  "action": "buy",
  "amount": 100,
  "maxSlippage": 2,
  "expectedPrice": 0.65
}
```

**Trade Response:**
```json
{
  "tradeId": "uuid",
  "sharesTransacted": 142.3,
  "totalCost": 100.00,
  "averagePrice": 0.703,
  "priceImpact": 0.82,
  "yesPriceBefore": 0.650,
  "yesPriceAfter": 0.658,
  "fee": 0.50,
  "newBalance": 9900.00
}
```

### Portfolio
```
GET    /api/v1/portfolio                  # Overview
GET    /api/v1/portfolio/positions        # Open positions with live PnL
GET    /api/v1/portfolio/trades           # Trade history
GET    /api/v1/portfolio/balance-history  # Balance transactions
GET    /api/v1/portfolio/pnl              # PnL summary
```

### Analytics (Charts)
```
GET    /api/v1/analytics/markets/:id/candles
         ?resolution=1h&limit=200&from=1700000000&to=1700100000

GET    /api/v1/analytics/markets/:id/price-line
         ?from=...&to=...&points=200

GET    /api/v1/analytics/markets/:id/volume
         ?resolution=1d&limit=30

GET    /api/v1/analytics/platform
```

### Activity Feed
```
GET    /api/v1/activity                   # Global feed
GET    /api/v1/activity/markets/:id       # Market-specific feed
GET    /api/v1/activity/me                # User's own activity (auth)
```

### Admin
```
GET    /api/v1/admin/markets?status=pending
POST   /api/v1/admin/markets/:id/resolve   # { outcome: "yes"|"no"|"invalid" }
PATCH  /api/v1/admin/markets/:id/feature
GET    /api/v1/admin/users
PATCH  /api/v1/admin/users/:id/status
GET    /api/v1/admin/reports
GET    /api/v1/admin/stats
```

## WebSocket Protocol

Connect to `ws://localhost:3000/ws`

```js
// Authenticate
ws.send(JSON.stringify({ type: "auth", token: "your-jwt" }))

// Subscribe to market
ws.send(JSON.stringify({ type: "subscribe_market", marketId: "uuid" }))

// Subscribe to portfolio updates
ws.send(JSON.stringify({ type: "subscribe_portfolio" }))
```

**Incoming events:** `price_update`, `trade`, `market_resolved`, `portfolio_update`, `heartbeat`

## Setup

### 1. Clone & install
```bash
npm install
cp .env.example .env
# Edit .env with your values
```

### 2. Start with Docker
```bash
docker-compose up -d postgres redis
npm run migration:run
npm run seed
npm run start:dev
```

### 3. Full Docker stack
```bash
docker-compose up -d
```

### 4. Debug tools (pgAdmin, Redis Commander)
```bash
docker-compose --profile debug up -d
```

## Monitoring

- **Health:** `GET /health`
- **Detailed health:** `GET /health/detailed`
- **Prometheus metrics:** `GET /metrics`

### Key metrics
- `pm_http_request_duration_seconds` — request latency histograms
- `pm_trades_total` — trade counter by side/action
- `pm_trade_volume_total` — total USD traded
- `pm_active_markets` — gauge
- `pm_websocket_clients` — connected clients

## Database Schema

13 tables:
- `users`, `refresh_tokens` — auth
- `balances`, `balance_transactions` — financial ledger
- `markets`, `market_categories` — market data
- `orders`, `trades` — order book + execution
- `positions` — per-user per-market holdings
- `price_history`, `price_candles` — time-series
- `liquidity_events`, `activity_feed`, `market_reports`

## Security

- JWT access tokens (15m) + refresh tokens (7d, rotated)
- Token reuse detection → revoke all sessions
- Brute-force protection (5 attempts → 15min lockout)
- Zod input validation on all endpoints
- Helmet security headers
- Rate limiting: 100/min general, 30/min trading, 20/15min auth
- `SELECT FOR UPDATE` prevents double-spending
- Sensitive fields stripped from responses
