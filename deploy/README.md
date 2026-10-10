# Прод: wellex.fun

Хост `157.22.192.92` (Ubuntu 24.04) **общий**: на нём ispmanager и чужой проект
(walkie: pm2 на `:3000`, apache, mysql, Postgres `main` на `:5432`, почта).
Их не трогаем. Всё Wellex изолировано:

| Что | Где |
|-----|-----|
| Код | `/opt/wellex/{backend,frontend}`, пользователь `wellex` |
| Node | свой Node 20 в `/opt/wellex/node` (системный Node 22 — чужой) |
| API | `wellex-api.service` (systemd), `127.0.0.1:3100`, env `/opt/wellex/backend.env` |
| Postgres | отдельный кластер `16/wellex` на `127.0.0.1:5434`, БД `prediction_market`, роль `wellex` |
| Redis | `redis-server.service`, `127.0.0.1:6379`, с паролем (Wellex — единственный клиент) |
| nginx | только `/etc/nginx/conf.d/wellex.conf` (+ `/etc/nginx/wellex-cloudflare-realip.inc`), источник — `deploy/nginx-wellex.conf` |
| TLS | Let's Encrypt `/etc/letsencrypt/live/wellex.fun`, DNS-01 через Cloudflare API (`/root/.secrets/cloudflare-wellex.ini`), `certbot.timer` |
| Логи | `journalctl -u wellex-api`, `/opt/wellex/logs`, `/var/log/nginx/wellex.*.log` |

Домен за Cloudflare (proxy, SSL mode Full). Реальный IP клиента восстанавливается
из `CF-Connecting-IP`.

## Важно про nginx

`conf.d` подключается **раньше** дефолтного server-блока ispmanager в `nginx.conf`.
Поэтому в `wellex.conf` нет блока `listen 80` — он стал бы дефолтным для всего сервера
(сломал бы roundcube/phpmyadmin соседа). HTTP→HTTPS делает Cloudflare
(«Always Use HTTPS»). HTTP-01 здесь не работает: Cloudflare не редиректит
`/.well-known/acme-challenge/`, и запрос попадает в дефолтный сервер ispmanager.
Поэтому сертификат выпускается через DNS-01 (`certbot-dns-cloudflare`, токен с правом
Zone DNS Edit только на `wellex.fun`).

После правки конфига: `nginx -t && systemctl reload nginx`. `nginx.conf` не редактировать.

## Лендинг и приложение на одном домене

`deploy.sh frontend` собирает один web-root `/opt/wellex/frontend`: сборка SPA +
`landing/index.html` → `landing.html`, `landing/assets/*` → `assets/` (скрипт падает при
совпадении имён), `landing/legal/*.html` → `legal/`.

| URL | Что отдаётся |
|-----|--------------|
| `/` | лендинг (`landing.html`) |
| `/markets` | главная SPA (список рынков); `/` внутри SPA редиректит сюда |
| `/legal/<slug>` | статическая страница лендинга, иначе SPA |
| остальное | SPA (`index.html`) |

## Обновление

```bash
deploy/deploy.sh            # backend + frontend
deploy/deploy.sh frontend   # только статика
```

Миграции применяются автоматически при старте API.

## Секреты (только на сервере, root)

`/opt/wellex/backend.env`, `/root/.wellex-{db,redis}-pw`, `/root/.wellex-admin-cred`,
`/root/.secrets/cloudflare-wellex.ini`.
Демо-аккаунты из сидов (`*@example.com`) получили случайные пароли; `SEED_ON_START=false`.
