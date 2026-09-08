# Changelog — Wellex

> Архитектурно значимые изменения проекта  
> Формат: дата | изменение | влияние

---

## 2026-09-08

| Изменение | Влияние |
|-----------|---------|
| Добавлены Cursor rules (`.cursor/rules/`) + `AGENTS.md` + память `.ai/` | Агенты планируют до кода и держат архитектурную память |
| Игровая валюта WX, магазин, реклама, ingest Polymarket, MM-боты | Торговля не в USD; каталог с Gamma API; create только moderator+ |
| ЮKassa для пакетов WX (`PaymentProvider`) | Redirect checkout; кредит по webhook / sync; mock без ключей |
| `LOCAL.md` — как поднять Docker + Vite | Единая инструкция локального запуска |
| Коллатерал MM-инвентаря + защита fee-sink | Резолюция не уводит `exchange` в минус; боты платят 1 WX за YES+NO сет |
| Rewarded ads: сессии + РСЯ-обвязка | `POST /economy/ads/session`; `AD_PROVIDER=mock\|yandex`; фронт `RewardedAd` |
| Rate limit 300/мин, economy 60/мин, IP-allowlist webhook | Дефолт больше не «выключен» |
| Expire ордеров, self-trade, sync цен Polymarket, daily bonus, comments, notifications, leaderboard period | Закрыт оставшийся backlog аудита |
| WS-ресаб marketIds, returnUrl после логина, удаление mock-data | Живые подписки и чище фронт |

---

## 2026 (main, до документации)

| Изменение | Влияние |
|-----------|---------|
| i18n RU + правки фронта (`9ef06a5`, `1c9e85f`) | UI на русском |
| Order book на фронте и бэке (`1cae0e9`) | Стакан и LIMIT в продукте |
| Трейды только через order book (`abe5e95`) | LMSR больше не движок исполнения |
| Типизированные даты (`7402a0a`) | Единый `lib/date.ts` |
| Портфель с бэкенда (`0675ba6`) | Убраны моки позиций |
| Связка маркетов/категорий/трейдинга (`9b18d1e`) | Первый рабочий fullstack-контур |
| Initial scaffold (`2fa050f`) | Express модули, Knex schema, Vite SPA |
