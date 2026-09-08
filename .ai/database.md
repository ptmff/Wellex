# Database — Wellex

> Последнее обновление: 2026-09-08

## Общие сведения

| Параметр | Значение |
|----------|----------|
| СУБД | PostgreSQL 16 (`postgres:16-alpine`) |
| Локально | `localhost:5433`, БД **`prediction_market`**, user `postgres` / `secret` |
| Клиент | Knex 3 + `pg` |
| Connection | `backend/src/database/connection.ts` из Zod config |
| Миграции | `backend/src/database/migrations/001_initial_schema.ts` |
| CLI | `npm run migration:run`, revert: `npm run migration:revert` |
| Seeds | `npm run seed` → `run-seeds-cli.ts` |
| Расширения | `uuid-ossp`, `btree_gist` |

Креды и примеры запросов — `.cursor/rules/ops-access.mdc`.  
Команды миграций — `.cursor/rules/knex-migrations.mdc`.

Имена таблиц и колонок — **snake_case**, без обязательных кавычек.

## Таблицы

| Таблица | Назначение |
|---------|------------|
| `users` | Аккаунты, роли, lockout, **`is_bot`** |
| `refresh_tokens` | Хеши refresh, revoke, device |
| `balances` | available/reserved/total + cash-колонки, `currency` default **WX**, `version` |
| `balance_transactions` | Леджер: deposit, trade_*, fee, **purchase**, **ad_reward**, **signup_bonus**, … |
| `coin_packages` | Пакеты WX для магазина |
| `coin_purchases` | Покупки (provider=`mock`, статус pending/succeeded/failed) |
| `ad_rewards` | Выдачи за рекламу (кулдаун считается по этой таблице) |
| `market_categories` | Категории (slug unique) |
| `markets` | Рынок + **`external_source`/`external_id`** (уник. для Polymarket) |
| `orders` | Стакан: side/type/action/status, qty, fills |
| `trades` | Исполненные сделки (`trade_type` default `order_book`) |
| `positions` | Позиция user×market×side; `reserved_quantity` для LIMIT SELL |
| `price_history` | Сырой ряд цен |
| `price_candles` | OHLCV (`1m`…`1w`) |
| `liquidity_events` | Аудит ликвидности |
| `activity_feed` | Публичная лента |
| `market_reports` | Жалобы модерации |

FTS: GIN `to_tsvector('english', title \|\| description)` на `markets`.

## Инварианты (торговля)

- Сделки и смена резервов — в одной транзакции Knex
- LIMIT BUY резервирует cash; LIMIT SELL — `positions.reserved_quantity`
- `version` на balances/positions/markets — optimistic concurrency
- Не обновлять прод-данные: продакшен БД не описан

## Сиды (dev)

Категории + пользователи (`admin@example.com`, `alice@…`, traders, `exchange@…`), боты ingest/MM, пакеты WX. Пароль сидов `Password123` — только локально. Стартовый баланс людей — `INITIAL_USER_BALANCE` (1000 WX); у ботов — `BOT_USER_BALANCE`.
