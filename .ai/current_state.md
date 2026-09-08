# Current State — Wellex

> Последнее обновление: 2026-09-08  
> Git branch: `main`

## Текущее состояние проекта

Учебный fullstack prediction market. Активная ветка — `main`.

**Runtime:** Node.js + Express, React/Vite  
**Database:** PostgreSQL 16 — локально `prediction_market` (compose `postgres`, хост-порт **5433**)  
**Cache:** Redis 7 на `6379`  
**Trading engine:** order book only  
**Валюта:** игровая **WX** (не USD). Регистрация = **1000 WX**. Докупка — ЮKassa (`PAYMENT_PROVIDER=yookassa`) или mock + рекламная награда.

**Каталог рынков:** ежедневный ingest с Polymarket Gamma API + создание **moderator/admin**. MM-боты сидят стакан.

## Последние реализованные функции

| Область | Изменение |
|---------|-----------|
| Economy | `/api/v1/economy` пакеты, ЮKassa/mock purchase, webhook, ad-reward |
| Ingest | Gamma API, cron полночь, `POST /admin/ingest/run`, `INGEST_ON_START` |
| Bots | `bot_ingest`, `bot_mm_1..3`, сидинг LIMIT вокруг implied-цены |
| Frontend | `/shop`, WX вместо `$`, create только для staff |
| Economy fix | MM-инвентарь оплачивается: `debitWx` с бота → `liquidity_total`; fee-sink в `resolveMarket` не уходит в минус (дефицит логируется) |
| Ads | Rewarded-сессии: `POST /economy/ads/session` (nonce в Redis, TTL 10 мин) → `POST /economy/ad-reward` c `sessionId`; advisory-lock против накрутки; `AD_PROVIDER=mock\|yandex` (+`YANDEX_RTB_BLOCK_ID`), фронт-компонент `RewardedAd` (РСЯ rewarded / mock-таймер) |
| Security | Rate limit включён (300/мин дефолт), отдельный limiter на `/economy` (60/мин), IP-allowlist webhook ЮKassa (только prod), `trust proxy` в prod |
| Frontend fix | WS: ресаб при изменении marketIds, сброс backoff, очистка таймера; `ProtectedRoute` → `/login` c возвратом; локализация причин ad-кулдауна (`reasonCode`); удалён `lib/mock-data.ts` (`formatVolume` → `lib/money.ts`) |
| Order book | Expire рынка снимает ордера; LIMIT BUY синхронизирует legacy `available`/`reserved`; запрет self-trade |
| Ingest | Intraday каждые 15 мин: цены Polymarket + requote MM; резолюция по `winner`/`outcome` |
| Product | Daily bonus, комментарии, уведомления (колокол), leaderboard 7d/30d, `/payment/result`, поиск Navbar |

На хосте Windows порт **5433** может быть занят локальным Postgres; API в Docker ходит в `postgres:5432` внутри сети compose.

## Активные домены

| Домен | Статус |
|-------|--------|
| Auth JWT | Работает |
| Markets | Ingest + moderator create |
| Order book | LIMIT + MARKET |
| WX economy | ЮKassa + mock fallback; ads: mock или РСЯ (`AD_PROVIDER`) |
| Polymarket ingest | Работает (проверено: ~30 рынков, 360 MM-ордеров) |
