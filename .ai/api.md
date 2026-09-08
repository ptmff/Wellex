# API — Wellex

> Последнее обновление: 2026-09-08

## Общие соглашения

| Параметр | Значение |
|----------|----------|
| Base URL | `/api/v1` (`config.API_VERSION`) |
| Auth | `Authorization: Bearer <access>` |
| Формат | JSON `{ success, data }` / `{ success: false, error }` |
| Валидация | Zod |
| Rate limit | 100/min general; trading 30/min; auth 20 / 15 min |
| Health | `GET /health`, `GET /health/detailed` (без `/api/v1`) |
| Metrics | `GET /metrics` Prometheus |

Роли: `user`, `moderator`, `admin` (иерархия в `requireRole`).

---

## Auth — `/api/v1/auth`

| Method | Route | Auth | Описание |
|--------|-------|------|----------|
| POST | `/register` | нет | Регистрация + **1000 WX** (`signup_bonus`) |
| POST | `/login` | нет | Логин |
| POST | `/refresh` | refresh body | Новая пара токенов |
| POST | `/logout` | да | Revoke |
| GET | `/me` | да | Текущий пользователь |

## Users — `/api/v1/users`

| Method | Route | Auth | Описание |
|--------|-------|------|----------|
| GET | `/leaderboard` | нет | Лидерборд |
| GET | `/search` | нет | Поиск |
| GET | `/me` | да | Профиль |
| PATCH | `/me` | да | Профиль |
| PATCH | `/me/username` | да | Username |
| GET | `/:username` | нет | Публичный профиль |

## Markets — `/api/v1/markets`

| Method | Route | Auth | Описание |
|--------|-------|------|----------|
| GET | `/` | нет | Список (фильтры, search, page) |
| GET | `/categories` | нет | Список категорий |
| GET | `/:id` | нет | Карточка |
| POST | `/` | **moderator+** | Создать рынок |
| PATCH | `/:id` | да | Обновить (creator/admin) |
| GET | `/:id/stats` | нет | Статистика |
| PATCH | `/:id/status` | moderator+ | Pause/activate |

## Trading — `/api/v1/trading`

| Method | Route | Auth | Описание |
|--------|-------|------|----------|
| POST | `/:marketId/quote` | нет | Оценка market-сделки |
| POST | `/:marketId/trade` | да | MARKET taker |

Body trade: `{ side: yes\|no, action: buy\|sell, amount, maxSlippage?, expectedPrice? }`.

## Orders — `/api/v1/orders`

| Method | Route | Auth | Описание |
|--------|-------|------|----------|
| GET | `/book/:marketId` | нет | Снимок стакана |
| GET | `/` | да | Свои заявки |
| GET | `/:id` | да | Заявка |
| POST | `/:marketId` | да | LIMIT |
| DELETE | `/:id` | да | Cancel |

## Economy — `/api/v1/economy`

| Method | Route | Auth | Описание |
|--------|-------|------|----------|
| GET | `/packages` | нет | Пакеты WX |
| GET | `/me` | да | Баланс + `paymentProvider` + доступность рекламы |
| POST | `/purchase` | да | `{ packageSlug }` → mock: кредит сразу; ЮKassa: `{ status: pending, confirmationUrl }` |
| GET | `/purchases/:id` | да | Статус своей покупки (для ЮKassa синхронизирует с API) |
| POST | `/webhooks/yookassa` | нет | HTTP-уведомления ЮKassa; кредит WX идемпотентно |
| POST | `/ad-reward` | да | Награда за рекламу (кулдаун / дневной лимит) |

## Portfolio — `/api/v1/portfolio` (auth)

`GET /`, `/positions`, `/trades`, `/balance-history`, `/pnl`

## Analytics — `/api/v1/analytics`

`GET /markets/:id/candles|price-line|volume`, `GET /platform`

## Activity — `/api/v1/activity`

`GET /`, `/markets/:id`, `/me` (auth)

## Admin — `/api/v1/admin` (moderator+)

| Method | Route | Роль | Описание |
|--------|-------|------|----------|
| GET | `/markets` | mod | Очередь (pending) |
| POST | `/markets/:id/resolve` | mod | `{ outcome }` |
| POST | `/ingest/run` | admin | Ручной прогон Polymarket ingest |
| PATCH | `/markets/:id/feature` | admin | Featured |
| GET | `/users` | admin | Пользователи |
| PATCH | `/users/:id/status` | admin | ban/suspend |
| GET/PATCH | `/reports` | mod | Жалобы |
| GET | `/stats` | admin | Сводка |

## WebSocket — `/ws`

См. `.ai/workflows.md`. События: `price_update`, `trade`, `market_resolved`, `portfolio_update`, `heartbeat`.
