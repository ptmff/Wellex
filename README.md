## Wellex — платформа прогнозных рынков

`Wellex` — веб‑платформа для торговли на исходы (prediction markets): пользователи могут создавать рынки, торговать вероятностями и отслеживать статистику и динамику цен в реальном времени.

## Стек

- `Frontend`: React + Vite + TypeScript, UI на базе компонентов (Tailwind CSS), роутинг и запросы к API через клиентскую обвязку.
- `Backend`: Node.js + Express (TypeScript) — REST API, WebSocket, авторизация (JWT), работа с PostgreSQL (Knex/migrations), кэш и синхронизация через Redis, фоновые задачи.

Ключевой торговый модуль: автоматизированный маркет‑мейкер LMSR (Logarithmic Market Scoring Rule).

## Состав репозитория

- `frontend/` — клиентское приложение.
- `backend/` — серверная часть (API, WebSocket, БД/Redis, бизнес‑логика).

## Быстрый старт (локально для разработки)

### 1) Запуск PostgreSQL и Redis

Самый простой путь — Docker для `backend`.

```bash
cd backend
docker-compose up -d postgres redis
```

Если хотите поднять полный стек из `docker-compose.yml`, можно использовать:

```bash
cd backend
docker-compose up -d
```

### 2) Инициализация базы (миграции и сиды)

```bash
cd backend
npm install
npm run migration:run
npm run seed
```

### 3) Запуск бэкенда

```bash
cd backend
npm run start:dev
```

Ожидаемые адреса:

- HTTP API: `http://localhost:3000/api/v1`
- WebSocket: `ws://localhost:3000/ws`
- Health checks:
  - `GET /health`
  - `GET /health/detailed`

### 4) Запуск фронтенда

```bash
cd frontend
npm install
npm run dev
```

Фронтенд по умолчанию стартует на порту `8080` (Vite).

## Переменные окружения

### Frontend

Фронтенд читает настройки из `VITE_*` переменных.

Создайте файл `frontend/.env` (если его нет) и укажите, например:

```env
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_WS_BASE_URL=ws://localhost:3000/ws
```

Если ничего не задавать, используются значения по умолчанию, которые прописаны в `frontend/src/config.ts`.

### Backend

  
Перед запуском убедитесь, что в .env корректно заданы:

- PostgreSQL (хост/порт/имя/пользователь/пароль)
- Redis (хост/порт/база)
- JWT секреты и параметры времени жизни
- `PORT` и прочие настройки безопасности/лимитов

## API и WebSocket

Полная справка находится в `backend/README.md`.

Коротко:

- REST API доступно под префиксом `/api/v1`.
- Для real‑time обновлений используется WebSocket по адресу `/ws`.
- Протокол включает подписки на рынки и портфель, а также события наподобие обновления цены, сделок и heartbeat.

