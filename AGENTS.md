# AGENTS.md — Wellex

Instructions for AI agents working in this repository.

## Project

Wellex — веб-платформа прогнозных рынков (prediction markets): пользователи создают рынки, торгуют вероятностями (YES/NO) через order book, смотрят портфель и динамику цен в реальном времени.

СУБД: **PostgreSQL 16** (Docker). Кэш/очереди: **Redis 7**.

- **локально** — PostgreSQL `prediction_market` на `localhost:5433` (контейнер мапит `5433:5432`); Redis `localhost:6379`
- прод / удалённый стенд — пока не задокументированы; не выдумывать хосты и креды

## Before you start

1. Read `.ai/project_overview.md`, `.ai/architecture.md`, `.ai/current_state.md`
2. Check `git status`, `git diff`, recent commits
3. Follow `.cursor/rules/ai-architect.mdc` — plan first, implement only after approval

## Key paths

| Path | Purpose |
|------|---------|
| `.ai/` | Project memory and architecture docs |
| `.cursor/rules/` | Cursor project rules |
| `backend/src/modules/` | REST routers + domain services |
| `backend/src/database/` | Knex connection, migrations, seeds |
| `backend/src/infrastructure/` | Redis, WebSocket, BullMQ, cron, Prometheus |
| `frontend/src/pages/` | React routes |
| `frontend/src/api/` | HTTP-клиент к `/api/v1` |

## Ops access (DB & Redis)

When asked to inspect DB or Redis, use `.cursor/rules/ops-access.mdc`:
- **Local DB** — PostgreSQL 16 (`postgres` service) on `localhost:5433`, database **`prediction_market`** (full access)
- **Local Redis** — `localhost:6379`
- Не менять данные без явной просьбы пользователя

## Migrations (Knex)

Перед **любыми** миграциями/сидами из терминала:

1. Поднять Postgres/Redis: `cd backend && docker-compose up -d postgres redis`
2. Задать env (`DB_HOST`, `DB_PORT=5433`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, JWT-секреты) — без них `config` падает на Zod
3. `npm run migration:run` / `npm run seed` из `backend/`

Полная инструкция: `.cursor/rules/knex-migrations.mdc`.

## Git commits

Не упоминать AI/Cursor в коммитах и метаданных. См. `.cursor/rules/git-commits.mdc`.

## Full rules

- `.ai/agent_rules.md` — complete architect rule set
- `.cursor/rules/ai-architect.mdc` — always-applied Cursor rule
- `.cursor/rules/ops-access.mdc` — local DB and Redis
- `.cursor/rules/knex-migrations.mdc` — Knex migrations + seeds
- `.cursor/rules/git-commits.mdc` — no AI/Cursor attribution in commits
- `.cursor/rules/wellex-typescript.mdc` — TypeScript conventions (backend + frontend)
