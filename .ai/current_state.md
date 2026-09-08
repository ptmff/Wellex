# Current State — Wellex

> Последнее обновление: 2026-09-08  
> Git branch: `main`

## Текущее состояние проекта

Учебный fullstack prediction market. Активная ветка — `main`.

**Runtime:** Node.js + Express, React/Vite  
**Database:** PostgreSQL 16 — локально `prediction_market` (compose `postgres`, хост-порт **5433**)  
**Cache:** Redis 7 на `6379`  
**Trading engine:** order book only  
**Валюта:** игровая **WX** (не USD). Регистрация = **1000 WX**. Докупка — mock shop + рекламная награда.

**Каталог рынков:** ежедневный ingest с Polymarket Gamma API + создание **moderator/admin**. MM-боты сидят стакан.

## Последние реализованные функции

| Область | Изменение |
|---------|-----------|
| Economy | `/api/v1/economy` пакеты, mock purchase, ad-reward с кулдауном |
| Ingest | Gamma API, cron полночь, `POST /admin/ingest/run`, `INGEST_ON_START` |
| Bots | `bot_ingest`, `bot_mm_1..3`, сидинг LIMIT вокруг implied-цены |
| Frontend | `/shop`, WX вместо `$`, create только для staff |

На хосте Windows порт **5433** может быть занят локальным Postgres; API в Docker ходит в `postgres:5432` внутри сети compose.

## Активные домены

| Домен | Статус |
|-------|--------|
| Auth JWT | Работает |
| Markets | Ingest + moderator create |
| Order book | LIMIT + MARKET |
| WX economy | Mock PSP + mock ads (порт под реальные позже) |
| Polymarket ingest | Работает (проверено: ~30 рынков, 360 MM-ордеров) |
