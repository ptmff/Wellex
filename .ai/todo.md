# TODO — Wellex

> Последнее обновление: 2026-09-08  
> Архитектурные задачи и технический долг

## Высокий приоритет

- [x] Подключить ЮKassa (`PAYMENT_PROVIDER=yookassa` + ключи магазина; без ключей остаётся mock)
- [ ] Подключить реальную rewarded-рекламу вместо 15с имитации
- [ ] **Синхронизировать README** с order book (убрать LMSR как «ключевой модуль»)
- [x] **Добавить `backend/.env.example`** (без секретов продакшена)
- [ ] Закоммитить / довести seeds CLI — **сделано в этом изменении** (`run-seeds-cli.ts`)
- [ ] Не держать в git `backend.zip` / случайные `help.txt`

## Средний приоритет

- [ ] Вынести incremental Knex-миграции вместо вечного `001_initial_schema.ts`
- [ ] Удалить или обновить `backend/test/lmsr.engine.test.ts` (движок убран)
- [ ] Admin UI на фронте (сейчас только API)
- [ ] Убрать leftover LMSR-поле `liquidity_b` или явно пометить deprecated в API
- [ ] Единый стиль валидации: везде `validate()` middleware vs `.parse` в handler

## Архитектурные задачи

- [ ] ADR: стратегия деплоя (один compose vs split frontend image)
- [ ] Health checks уже есть; выровнять `GET /health/detailed` с реальным Redis ping API
- [ ] Документировать инвариант балансов: `available`/`reserved` vs `available_cash`/`reserved_cash`
- [ ] Correlation id: `requestId` middleware есть — прокинуть в WS и логи сделок

## Потенциальные улучшения

- [ ] OpenAPI spec для `/api/v1`
- [ ] Rate limit на WS handshake
- [ ] Circuit / backpressure на matching при высокой нагрузке
- [ ] Structured metrics по latency matching, не только HTTP
