# Conventions — Wellex

> Последнее обновление: 2026-09-08

## Кодстайл

| Аспект | Соглашение |
|--------|------------|
| Language | TypeScript (backend ~5.3, frontend ~5.8) |
| Backend modules | CommonJS-style `import`/`export` через `tsc` |
| Frontend | ESM (`"type": "module"`), Vite |
| Async | `async/await`; Express + `express-async-errors` |
| Env | Zod `configSchema` — не читать `process.env` вразнобой (кроме CORS origins) |
| Деньги / qty | `decimal.js` в матчинге; в JSON — number |
| Даты на фронте | `frontend/src/lib/date.ts` — не `new Date().toLocaleString()` вразнобой |

## Архитектурные соглашения

### Backend module layout

```
backend/src/modules/{feature}/
  ├── {feature}.router.ts     — HTTP
  └── {feature}.service.ts    — бизнес-логика (если есть)
```

`trading` — только router; исполнение в `orders/orderbook.service.ts`.

### HTTP envelope

```ts
// success
{ success: true, data: T }

// error (errorHandler)
{ success: false, error: { code, message, timestamp, details?, requestId? } }
```

### Validation

- DTO: Zod object рядом с router/service (`TradeDto`, `PlaceLimitOrderDto`, …)
- Опционально middleware `validate(schema, 'body'|'query'|'params')` из `common/middleware.ts`

### Auth

- `authenticate(required = true)` — Bearer access JWT
- `requireRole('moderator'|'admin')` — иерархия user < moderator < admin
- Admin key: заголовок `X-Admin-Key` (см. guards)

### Data access

- Knex query builder, не ORM-модели
- Мутации торговли — `withTransaction`
- Optimistic locking: колонка `version` на `balances`, `markets`, `positions`

### Frontend

- Страницы — `pages/`; API — `frontend/src/api/*.ts`
- Все защищённые запросы через `useAuth().request` (refresh + retry)
- UI-kit: `components/ui/` (shadcn); бизнес-виджеты рядом с pages

### Именование

| Что | Как |
|-----|-----|
| Таблицы БД | snake_case, plural (`market_categories`) |
| Enum в PG | knex `.enum([...])` |
| Router export | `export { router as marketsRouter }` |
| React components | PascalCase файлы страниц |

## Чего не делать

- Не возвращать LMSR AMM без явного ADR и согласования
- Не ходить в БД в обход транзакции на trade/place/cancel
- Не коммитить `.env`, `backend.zip`, секреты
- Не добавлять AI-атрибуцию в git (`.cursor/rules/git-commits.mdc`)
