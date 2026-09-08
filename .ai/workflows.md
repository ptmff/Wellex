# Workflows — Wellex

> Последнее обновление: 2026-09-08

## Пользовательские сценарии

### 1. Регистрация и вход

```
1. POST /api/v1/auth/register → JWT pair + **1000 WX** (`signup_bonus`)
2. Фронт кладёт токены в session (localStorage via session.ts)
3. GET /api/v1/auth/me при старте AuthContext
4. Refresh: POST /api/v1/auth/refresh (ротация; reuse → revoke)
```

### 2. Просмотр и создание рынка

```
1. GET /api/v1/markets (фильтры, search, pagination)
2. GET /api/v1/markets/:id + stats / price-line
3. POST /api/v1/markets (**moderator/admin**) — title, description, resolution_criteria, closes_at, category; MM сидит стакан
4. Каталог также наполняет IngestService (Polymarket Gamma, раз в сутки)
5. Модератор: PATCH status / admin resolve (в т.ч. авто-resolve с Polymarket)
```

### 3. Market-сделка (taker)

```
1. POST /trading/:marketId/quote — оценка shares/cost/impact
2. POST /trading/:marketId/trade — authenticate
3. OrderBookService.executeMarketTrade — свип LIMIT на противоположной стороне
4. Обновление balances, positions, trades, price_history
5. WS: price_update, trade, portfolio_update
```

### 4. LIMIT-заявка (maker)

```
1. POST /orders/:marketId { side, action, price, quantity }
2. Резерв cash (buy) или shares (sell / reserved_quantity)
3. Matching с resting book; остаток → status open / partially_filled
4. DELETE /orders/:id — снять заявку, вернуть резерв
```

### 5. Портфель

```
GET /portfolio
GET /portfolio/positions
GET /portfolio/trades
GET /portfolio/pnl
POST /economy/ad-reward
WS subscribe_portfolio
```

### 5b. Покупка WX

```
1. POST /economy/purchase { packageSlug }
2. mock → сразу creditWx; yookassa → confirmationUrl, редирект на кассу
3. ЮKassa HTTP-уведомление POST /economy/webhooks/yookassa
   (локально без туннеля: GET /economy/purchases/:id сам спрашивает API ЮKassa)
4. Идемпотентный кредит WX, coin_purchases.status = succeeded
```

### 6. Резолюция рынка (admin/moderator)

```
1. POST /admin/markets/:id/resolve { outcome: yes|no|invalid }
2. Выплата / списание позиций, статус resolved
3. WS market_resolved
```

## Системные процессы

### Старт backend

```
checkDatabaseConnection
→ runMigrations (001_initial_schema)
→ optional runSeeds (SEED_ON_START)
→ HTTP + WS listen
→ startScheduledJobs + BullMQ workers
```

### Cron (`infrastructure/jobs/scheduler.ts`)

| Расписание | Действие |
|------------|----------|
| каждую минуту | свечи `1m`; expire рынков по `closes_at` |
| каждые 5 мин | `5m`, `15m` |
| каждый час | `1h`, `4h`, gauges |
| полночь | `1d`, сброс `volume_24h`, **Polymarket ingest + auto-resolve** |

### Realtime

```
ws://host/ws
  auth { token }
  subscribe_market { marketId }
  subscribe_portfolio
события: price_update, trade, market_resolved, portfolio_update, heartbeat
```

Масштаб: Redis pub/sub, чтобы несколько инстансов API видели одни события.
