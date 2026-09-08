# Architectural Decisions (ADR) — Wellex

> Последнее обновление: 2026-09-08

## ADR-001: Монорепозиторий frontend + backend

**Статус:** Accepted

### Проблема
Нужны SPA и API с общей доменной моделью рынков/сделок без лишней инфраструктуры.

### Варианты
1. Два отдельных репозитория
2. Монорепо с `frontend/` и `backend/`
3. Next.js fullstack

### Выбранное решение
Два пакета в одном git-репо; Vite на 8080, Express на 3000, proxy в dev.

### Причины
- Простой деплой и учебный цикл
- Чёткое разделение UI и API
- Совпадает с текущей структурой

---

## ADR-002: Order book вместо LMSR AMM

**Статус:** Accepted (с `abe5e95`)

### Проблема
Нужен понятный механизм цены и встречных заявок, ближе к бирже, чем к subsidized AMM.

### Варианты
1. LMSR (Logarithmic Market Scoring Rule) — исходный дизайн README
2. CLOB / order book (LIMIT + MARKET taker)
3. Гибрид AMM + book

### Выбранное решение
Только order book: `OrderBookService`. MARKET — свип resting LIMIT.  
`markets.liquidity_b` оставлен для совместимости схемы.

### Причины
- Явный стакан на UI (`GET /orders/book/:marketId`)
- Контроль резервов cash/shares
- Проще объяснить matching, чем LMSR cost function

---

## ADR-003: Knex + идемпотентный initial schema

**Статус:** Accepted

### Проблема
Нужны миграции без тяжёлого ORM.

### Варианты
1. Prisma / TypeORM
2. Knex migrate CLI + набор timestamp-файлов
3. Один `001_initial_schema.ts` с `hasTable` / `IF NOT EXISTS`

### Выбранное решение
Вариант 3 + `npm run migration:run`. Новые колонки — `ALTER ... IF NOT EXISTS` в том же файле, пока нет нумерованной истории.

### Причины
- Быстрый старт
- Повторный запуск безопасен

**Следствие:** при росте схемы стоит перейти на настоящие incremental migrations (см. `.ai/todo.md`).

---

## ADR-004: JWT access + refresh rotation

**Статус:** Accepted

### Проблема
Stateless API и отзыв сессий.

### Выбранное решение
Короткий access JWT + refresh в таблице `refresh_tokens` (hash, revoke, reuse detection).

---

## ADR-005: decimal.js для матчинга

**Статус:** Accepted

Цены 0–1 и quantity с высокой точностью; IEEE float в ядре стакана запрещён. JSON по-прежнему отдаёт `number`.

---

## ADR-006: Игровая валюта WX вместо «реальных денег»

**Статус:** Accepted

Торговля только в WX. Регистрация даёт 1000 WX один раз. Пополнение: mock-магазин (`PaymentProvider`) и mock-реклама с серверным кулдауном. Реальный PSP и ad network подключаются заменой провайдера, без смены order book.

---

## ADR-007: Каталог с Polymarket Gamma + боты

**Статус:** Accepted

HTML polymarket.com не парсим. Источник — публичный Gamma API, cron раз в сутки, дедуп `external_source+external_id`. Создание рынков людьми — **moderator/admin**. Три MM-бота сидят стакан вокруг implied-цены; без них импортированные рынки пустые.
