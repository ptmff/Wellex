# Architecture — Wellex

> Последнее обновление: 2026-09-08

## Структура директорий

```
Wellex/
├── frontend/src/
│   ├── api/                 — HTTP-обёртки (/markets, /trading, /orders)
│   ├── auth/                — AuthContext, session tokens, ProtectedRoute
│   ├── pages/               — Index, MarketDetail, Portfolio, Profile, CreateMarket, Login, Register
│   ├── components/          — TradePanel, MarketCard, layout, ui (shadcn)
│   ├── hooks/               — usePortfolioWebSocket, toasts
│   └── i18n/                — RU/EN
└── backend/src/
    ├── config/              — Zod env
    ├── common/              — errors, guards, middleware, logger
    ├── database/            — Knex, 001_initial_schema, seeds
    ├── infrastructure/
    │   ├── redis/           — CacheService, distributed lock
    │   ├── websocket/       — WS + Redis pub/sub
    │   ├── queue/           — BullMQ (trades, analytics, maintenance)
    │   ├── jobs/            — node-cron (свечи, expiry)
    │   └── metrics/         — Prometheus
    └── modules/
        ├── auth/ users/ markets/ trading/ orders/
        ├── portfolio/ analytics/ activity/ admin/
        ├── economy/ ingest/ bots/
```

## Архитектурный стиль

**Модульный Express-монолит** + отдельная SPA. Слои внутри backend:

```
┌─────────────────────────────────────────┐
│  frontend (React SPA)                   │
│  pages → api/* → Bearer JWT / WS        │
└─────────────────┬───────────────────────┘
                  │ HTTP /api/v1  +  /ws
┌─────────────────▼───────────────────────┐
│  main.ts (composition root)             │
│  routers + app.locals services          │
└─────────────────┬───────────────────────┘
                  │
┌─────────────────▼───────────────────────┐
│  modules/*.service.ts                   │
│  OrderBookService — ядро матчинга       │
└─────────────────┬───────────────────────┘
                  │
     Knex / PostgreSQL     Redis / BullMQ
```

## Связи между модулями

| Слой | Зависит от |
|------|------------|
| routers | services, guards, Zod |
| `OrderBookService` | Knex `withTransaction`, Redis cache, `WebSocketService`, `ActivityService` |
| `trading.router` | тонкая обёртка над `OrderBookService` (quote + market trade) |
| `orders.router` | LIMIT place/cancel + стакан |
| frontend `api/` | `AuthContext.request` |

**Центральный торговый контракт:** `OrderBookService` (`backend/src/modules/orders/orderbook.service.ts`).

- LIMIT — resting заявки, matching order-to-order
- MARKET (`executeMarketTrade`) — taker, свип по стакану
- LMSR AMM **не используется** (остатки схемы: `markets.liquidity_b`)

**Composition:** `main.ts` кладёт сервисы в `app.locals`; роутеры читают `req.app.locals`.

## Основные потоки данных

1. **Auth** — register/login → JWT pair в `session.ts` → Bearer на API; refresh с ротацией.
2. **Create market** — `POST /markets` (**moderator/admin**) → active; бот ingest создаёт рынки из Polymarket.
3. **Trade** — quote → market trade или LIMIT в **WX**; транзакция Postgres → `trades` + `price_history` → WS.
4. **Charts** — cron/BullMQ агрегирует `price_candles`; fallback на raw `price_history`.
5. **Resolve** — admin/moderator `POST /admin/markets/:id/resolve` → outcome, расчёт позиций.

## Frontend routing

| Path | Auth | Страница |
|------|------|----------|
| `/` | нет | список рынков |
| `/market/:id` | нет | стакан, график, TradePanel |
| `/portfolio`, `/profile`, `/shop` | ProtectedRoute | портфель / профиль / магазин WX |
| `/create` | ProtectedRoute staffOnly | создать рынок (moderator/admin) |
| `/login`, `/register` | нет | JWT-сессия |

Vite dev-server (8080) проксирует `/api` и `/ws` на `localhost:3000`.
