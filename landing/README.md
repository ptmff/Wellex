# Лэндинг ВЕЛЛЕКС

Статичный одностраничник по брендборду (`StyleShit/`): цвета Deep Navy / Ice / Signal Green,
шрифты Manrope + Roboto Mono, логотип-бык.

Файлы:

- `index.html` — вся страница (стили и скрипты встроены, внешних зависимостей нет кроме Google Fonts)
- `assets/` — логотип в трёх размерах + фавиконка
- `_headers` — заголовки кэширования для Cloudflare Pages

## Локальный просмотр

```bash
cd landing
python3 -m http.server 8765
# открыть http://localhost:8765
```

## Публикация на Cloudflare Pages

### Вариант 1 — прямая загрузка через Wrangler (быстрее всего)

```bash
npx wrangler login                  # один раз
npx wrangler pages project create wellex-landing --production-branch main
npx wrangler pages deploy landing --project-name wellex-landing
```

Команды запускать из корня репозитория. После деплоя сайт будет на
`https://wellex-landing.pages.dev`, дальше в дашборде Cloudflare можно привязать свой домен
(Workers & Pages → wellex-landing → Custom domains).

### Вариант 2 — автодеплой из Git

Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git → выбрать репозиторий:

| Поле | Значение |
|------|----------|
| Framework preset | None |
| Build command | *(пусто)* |
| Build output directory | `landing` |

Каждый push в `main` будет публиковаться автоматически.

## Что поправить перед запуском

- Ссылки `href="#"` в финальном CTA и подвале — подставить реальные URL приложения
  (регистрация, список рынков, оферта, политика).
- Цифры в блоке статистики и бегущей строке — заменить на фактические.
- `og:image` — сделать полноценную картинку 1200×630 вместо логотипа.
