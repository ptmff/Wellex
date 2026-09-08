# Project Overview — Wellex

> Последнее обновление: 2026-09-08  
> Источник истины: репозиторий `Wellex` (ветка `main`)

## Назначение проекта

**Wellex** — веб-платформа прогнозных рынков (prediction markets): пользователи создают бинарные рынки (YES/NO), торгуют долями исхода через order book, следят за портфелем, PnL и динамикой цен в реальном времени.

Учебный / продуктовый монорепозиторий: SPA + REST/WebSocket backend.

## Основные функции

| Область | Функции |
|---------|---------|
| **Рынки** | Список, поиск, категории, создание, пауза, резолюция |
| **Торговля** | Market-сделки (taker) и LIMIT-заявки (maker), стакан, quote |
| **Портфель** | Баланс в **WX** (игровая валюта), позиции, история сделок, PnL |
| **Экономика** | Стартовые 1000 WX, магазин пакетов (mock-оплата), награда за рекламу |
| **Рынки** | Каталог с Polymarket (раз в сутки) + создание модератором/админом |
| **Аналитика** | OHLCV-свечи, price line, объём, платформенные метрики |
| **Активность** | Лента событий рынка / пользователя |
| **Админка** | Модерация рынков, резолюция, пользователи, жалобы |
| **Realtime** | WebSocket: цены, сделки, портфель, heartbeat |

## Технологический стек

| Категория | Технология |
|-----------|------------|
| Frontend | React 18, Vite 5, TypeScript, Tailwind, shadcn/Radix, TanStack Query, react-router 6 |
| Backend | Node.js, Express 4, TypeScript 5 |
| Валидация | Zod (env + DTO) |
| ORM / SQL | Knex 3 + `pg` |
| СУБД | PostgreSQL 16 (Docker, хост-порт `5433`) |
| Кэш / pub-sub / очереди | Redis 7, BullMQ |
| Auth | JWT access (15m) + refresh (7d, rotation) |
| Realtime | `ws` + Redis pub/sub |
| Деньги | Игровая валюта **WX** (`decimal.js`); реальный эквайринг пока mock |
| Метрики | Prometheus (`prom-client`) |
| Логи | Winston |
| Контейнеризация | Docker Compose (`backend/docker-compose.yml`) |

## Структура репозитория

```
Wellex/
├── frontend/          — Vite SPA (порт 8080, proxy /api и /ws → :3000)
├── backend/           — Express API + WS (порт 3000)
│   ├── src/modules/   — auth, users, markets, trading, orders, portfolio, analytics, activity, admin, economy, ingest, bots
│   ├── src/database/  — Knex, migrations, seeds
│   └── src/infrastructure/ — redis, websocket, queue, jobs, metrics
├── AGENTS.md
├── .cursor/rules/
└── .ai/
```

## Внешние интеграции

Отдельных платёжных / GDS-интеграций нет (оплата — `MockPaymentProvider`). Внешний мир:

| Интеграция | Назначение |
|------------|------------|
| PostgreSQL | Источник истины по рынкам, ордерам, балансам WX |
| Redis | Кэш, pub/sub для WS, BullMQ |
| Polymarket Gamma API | Ежедневный ingest событий (`https://gamma-api.polymarket.com`) |
| (опционально) ngrok | `allowedHosts` во Vite для туннеля |

## Локальный запуск

См. корневой `README.md` и `.cursor/rules/ops-access.mdc`.
