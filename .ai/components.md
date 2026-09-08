# Components — Wellex

> Последнее обновление: 2026-09-08

## Backend

| Компонент | Путь | Ответственность |
|-----------|------|-----------------|
| `main.ts` | `backend/src/main.ts` | Composition root: middleware, routers, WS, jobs, graceful shutdown |
| `config` | `backend/src/config/index.ts` | Zod env |
| `db` / `withTransaction` | `backend/src/database/connection.ts` | Knex pool |
| `runMigrations` | `database/migrations/001_initial_schema.ts` | Схема |
| `runSeeds` | `database/seeds/run-seeds.ts` | Демо-данные |
| `authenticate` / `requireRole` | `common/guards.ts` | JWT + роли |
| `errorHandler` / `AppError` | `common/errors.ts` | Единый error envelope |
| `AuthService` | `modules/auth/auth.service.ts` | Register/login/refresh/lockout |
| `MarketsService` | `modules/markets/markets.service.ts` | CRUD рынков |
| `OrderBookService` | `modules/orders/orderbook.service.ts` | LIMIT, MARKET, стакан, резервы |
| `trading.router` | `modules/trading/trading.router.ts` | quote + market trade → OrderBookService |
| `PortfolioService` | `modules/portfolio/portfolio.service.ts` | Баланс, позиции, PnL |
| `AnalyticsService` | `modules/analytics/analytics.service.ts` | Свечи, price-line, volume |
| `ActivityService` | `modules/activity/activity.service.ts` | Лента |
| `WebSocketService` | `infrastructure/websocket/ws.service.ts` | Подписки, Redis pub/sub |
| `CacheService` | `infrastructure/redis/cache.service.ts` | Кэш рынков/юзеров/стакана |
| BullMQ queues | `infrastructure/queue/queues.ts` | trade-processing, analytics, maintenance |
| `EconomyService` | `modules/economy/` | пакеты WX, purchase (ЮKassa/mock), webhook, ad-session + ad-reward |
| `PaymentProvider` | `modules/economy/payment.provider.ts` | порт: mock или `YooKassaPaymentProvider` |
| `debitWx` / `creditWx` | `modules/economy/wallet.ts` | леджер WX |
| `IngestService` | `modules/ingest/` | Polymarket Gamma → рынки Wellex |
| `MarketMakerService` | `modules/bots/` | LIMIT-лестница ботов; инвентарь оплачивается в `liquidity_total` |
| scheduler | `infrastructure/jobs/scheduler.ts` | Cron свечей, expiry, **daily ingest** |
| Prometheus | `infrastructure/metrics/prometheus.ts` | `/metrics` |

## Frontend

| Компонент | Путь | Ответственность |
|-----------|------|-----------------|
| `App.tsx` | `frontend/src/App.tsx` | Routes + providers |
| `AuthContext` | `auth/AuthContext.tsx` | JWT, `request()`, refresh |
| `api/markets.ts` | `frontend/src/api/` | Список/CRUD рынков |
| `api/trading.ts` | | quote + market trade |
| `api/orders.ts` | | LIMIT, book, cancel |
| `api/economy.ts` | пакеты, purchase, ad-session, claim |
| `RewardedAd` | `components/RewardedAd.tsx` | mock-таймер или РСЯ rewarded |
| `TradePanel` | `components/TradePanel.tsx` | UI сделки в WX |
| `Index` | `pages/Index.tsx` | Каталог рынков |
| `Shop` | `pages/Shop.tsx` | Покупка WX + реклама |
| `MarketDetail` | `pages/MarketDetail.tsx` | Рынок + стакан |
| `Portfolio` | `pages/Portfolio.tsx` | Позиции |
| i18n | `i18n/I18nContext.tsx` | RU/EN |

## Зависимости между ключевыми сервисами

```
trading.router ──► OrderBookService ──► Knex tx
orders.router  ──►        │
                          ├── WebSocketService
                          ├── ActivityService
                          └── Redis CacheService
```
