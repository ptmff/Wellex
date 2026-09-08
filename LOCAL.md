# Локальный запуск Wellex

Как поднять стек на машине разработчика: **PostgreSQL + Redis + API в Docker**, **фронт — Vite на хосте**.

Нужны: Docker Desktop, Node.js 20, npm.

Откройте UI: [http://localhost:8080/](http://localhost:8080/)  
API: [http://localhost:3000/health](http://localhost:3000/health)

Торговля идёт через **order book** (не LMSR). Валюта — игровая **WX**.

---

## 1. Backend в Docker (рекомендуемый путь)

Из корня репозитория:

```powershell
cd backend
docker compose up -d --build
```

Поднимаются три сервиса из `backend/docker-compose.yml`:

| Сервис | Что это | Порт на хосте |
|--------|---------|----------------|
| `postgres` | PostgreSQL 16, БД `prediction_market` | **5433** → 5432 в контейнере |
| `redis` | Redis 7 | **6379** |
| `api` | Express API + WebSocket | **3000** |

Контейнер `api` сам:

- ждёт healthy postgres/redis;
- прогоняет миграции;
- сидит демо-пользователей (`SEED_ON_START=true`);
- тянет рынки с Polymarket Gamma (`INGEST_ON_START=true`).

Проверка:

```powershell
docker compose ps
curl http://localhost:3000/health
curl http://localhost:3000/health/detailed
```

Ожидается `"status":"ok"`.

Остановка:

```powershell
cd backend
docker compose down
```

Данные postgres/redis живут в volumes (`postgres_data`, `redis_data`). Чтобы стереть БД: `docker compose down -v`.

После правок **backend-кода** контейнер крутит собранный `dist`, не `src`. Пересобрать API:

```powershell
cd backend
docker compose up -d --build api
```

---

## 2. Frontend (Vite, не в Docker)

Фронт в compose нет — его запускаем на хосте. Проксирует `/api` и `/ws` на `localhost:3000`, отдельный `.env` не обязателен.

```powershell
cd frontend
npm install
npm run dev
```

Адрес: **http://localhost:8080/**

`VITE_API_BASE_URL` по умолчанию `/api/v1` (тот же origin, что и Vite). Не ставьте `http://localhost:3000/api/v1`, если пользуетесь прокси — иначе CORS и куки/токены путаются.

Опционально `frontend/.env`:

```env
VITE_API_BASE_URL=/api/v1
```

---

## 3. Демо-логины

Пароль у всех: `Password123`

| Email | Роль |
|-------|------|
| `alice@example.com` | пользователь (торговля, магазин) |
| `moderator@example.com` | модератор (создание рынков) |
| `admin@example.com` | админ |

Новая регистрация даёт **1000 WX**.

---

## 4. Порты и типичные ловушки

| Проблема | Что делать |
|----------|------------|
| На Windows **5433 уже занят** локальным Postgres | Это другой сервер, не Docker. Контейнер `api` ходит в `postgres:5432` **внутри** сети compose — UI и API всё равно работают. Не гоняйте `npm run migration:run` с хоста на 5433, пока там не Docker. |
| `database "prediction_market" does not exist` | Подключились не к контейнеру. Хост-порт Docker — **5433**, не 5432. |
| API не стартует: `Invalid environment variables` | Нужны `DB_*`, JWT-секреты ≥ 32 символов, `ADMIN_SECRET_KEY`. В compose они уже заданы. |
| Фронт открылся, API 404/proxy error | Сначала должен слушать `:3000`. Проверьте `docker compose ps` и `/health`. |
| Старые рынки / нет сидов | В compose `SEED_ON_START=true`. Либо `npm run seed` из `backend/` с правильным `DB_PORT=5433`. |
| Изменили код API, в браузере старое поведение | `docker compose up -d --build api` |

---

## 5. Вариант: API на хосте (hot reload)

Docker только для БД и Redis, API через `ts-node-dev`.

```powershell
cd backend
docker compose up -d postgres redis

npm install

$env:DB_HOST = "localhost"
$env:DB_PORT = "5433"
$env:DB_NAME = "prediction_market"
$env:DB_USER = "postgres"
$env:DB_PASSWORD = "secret"
$env:JWT_ACCESS_SECRET = "local-dev-access-secret-min-32-chars!!"
$env:JWT_REFRESH_SECRET = "local-dev-refresh-secret-min-32-chars!"
$env:ADMIN_SECRET_KEY = "admin-local-dev-key"
$env:SEED_ON_START = "true"
$env:INGEST_ON_START = "true"
$env:PAYMENT_PROVIDER = "mock"

npm run start:dev
```

Шаблон переменных: `backend/.env.example` (скопировать в `backend/.env`).

Не запускайте хостовый API, пока контейнер `api` уже слушает `:3000` — будет конфликт порта. Тогда: `docker compose stop api`.

Миграции/сиды с хоста (тот же env, порт **5433**):

```powershell
cd backend
npm run migration:run
npm run seed
```

---

## 6. ЮKassa (не нужна для обычного запуска)

По умолчанию в compose: `PAYMENT_PROVIDER=mock` — покупка WX сразу зачисляется.

Живая касса:

```
PAYMENT_PROVIDER=yookassa
YOOKASSA_SHOP_ID=...
YOOKASSA_SECRET_KEY=...
PAYMENT_RETURN_URL=http://localhost:8080/shop
```

Webhook с интернета: `https://<туннель>/api/v1/economy/webhooks/yookassa`. Локально достаточно возврата на `/shop?purchase=...` — бэкенд сам спросит статус у API ЮKassa.

---

## 7. Полезные URL

| URL | Назначение |
|-----|------------|
| http://localhost:8080/ | UI |
| http://localhost:8080/shop | Магазин WX |
| http://localhost:3000/health | Жив ли API |
| http://localhost:3000/health/detailed | Postgres + Redis |
| http://localhost:3000/api/v1 | REST |
| ws://localhost:3000/ws | WebSocket (через Vite: тот же хост `:8080`) |

Опционально: `docker compose --profile debug up -d` — pgAdmin `:5050`, Redis Commander `:8081`.
