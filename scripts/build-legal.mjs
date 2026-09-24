/**
 * Генерирует статические страницы /legal/* для лэндинга
 * из тех же исходников, что использует фронтенд:
 *   frontend/src/legal/documents/*.ts
 *
 * Запуск:  node scripts/build-legal.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..');
const out = resolve(repo, 'landing');
const legalSrc = resolve(repo, 'frontend/src/legal');
const esbuild = resolve(repo, 'frontend/node_modules/.bin/esbuild');
const tmpEntry = resolve(out, '.legal-entry.ts');
const tmpOut = resolve(out, '.legal-bundle.mjs');

/* ── 1. собираем TS-исходники юр. документов в один ESM-модуль ── */
writeFileSync(tmpEntry, `
export { getLegalDocument, legalSlugs } from ${JSON.stringify(resolve(legalSrc, 'documents/index.ts'))};
export { legalRoutes, legalOperator, LEGAL_DOCS_VERSION } from ${JSON.stringify(resolve(legalSrc, 'config.ts'))};
`);
execFileSync(esbuild, [tmpEntry, '--bundle', '--format=esm', '--platform=node', `--outfile=${tmpOut}`, '--log-level=warning']);
const legal = await import(pathToFileURL(tmpOut).href + `?t=${Date.now()}`);
rmSync(tmpEntry, { force: true });
rmSync(tmpOut, { force: true });

const { getLegalDocument, legalSlugs, legalRoutes, legalOperator, LEGAL_DOCS_VERSION } = legal;

/* ── 2. шаблон ── */
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const formatDate = (iso) => {
  const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return esc(iso);
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()} г.`;
};

const cookieBanner = `
<div class="cookie-banner" id="cookie-banner" role="region" aria-label="Уведомление об использовании cookie">
  <div class="container cookie-in">
    <div class="cookie-text">
      <strong>Мы используем файлы cookie</strong>
      Необходимые cookie нужны для работы сайта. Яндекс.Метрика (аналитика) подключается только с вашего согласия.
      <a href="/legal/cookies">Политика cookie</a> · <a href="/legal/privacy">Политика конфиденциальности</a>
    </div>
    <div class="cookie-actions">
      <button type="button" class="btn btn-cookie-ghost" id="cookie-reject">Только необходимые</button>
      <button type="button" class="btn btn-primary" id="cookie-accept">Принять все</button>
    </div>
  </div>
</div>`;

function renderSection(section, idx) {
  const paragraphs = (section.paragraphs || [])
    .map((p) => `      <p>${esc(p)}</p>`).join('\n');
  const list = section.list && section.list.length
    ? `      <ul>\n${section.list.map((li) => `        <li>${esc(li)}</li>`).join('\n')}\n      </ul>\n`
    : '';
  return `    <section class="doc-section" id="s${idx + 1}">
      <h2>${esc(section.title)}</h2>
${paragraphs}
${list}    </section>`;
}

function renderPage(slug) {
  const route = legalRoutes[slug];
  const doc = getLegalDocument(slug, 'ru');
  if (!doc) throw new Error(`нет документа для слага ${slug}`);

  const nav = legalSlugs.map((s) => {
    const r = legalRoutes[s];
    const current = s === slug;
    return `      <a href="${r.path}"${current ? ' class="is-current" aria-current="page"' : ''}>${esc(r.titleRu)}</a>`;
  }).join('\n');

  const toc = doc.sections.map((sec, i) =>
    `        <a href="#s${i + 1}">${esc(sec.title)}</a>`).join('\n');

  const body = doc.sections.map(renderSection).join('\n\n');

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(route.titleRu)} — ВЕЛЛЕКС</title>
<meta name="description" content="${esc(route.titleRu)} платформы прогнозных рынков Веллекс. Редакция от ${formatDate(doc.updatedAt)}">
<meta name="theme-color" content="#12141a">
<link rel="icon" href="/assets/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="/assets/logo-180.png">
<link rel="canonical" href="${route.path}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@500;600;700;800&family=Roboto+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/legal.css">
</head>
<body>
<div class="bg-fx"></div>
<div class="wrap">

<header class="nav" id="nav">
  <div class="container nav-in">
    <a class="brand" href="/">
      <img src="/assets/logo.png" alt="Веллекс" width="38" height="38">
      <span>ВЕЛЛЕКС</span>
    </a>
    <a class="btn btn-ghost" href="/">← На главную</a>
  </div>
</header>

<main class="doc">
  <div class="container">
    <div class="doc-head">
      <span class="eyebrow">Правовые документы</span>
      <h1>${esc(route.titleRu)}</h1>
      <p class="doc-meta mono">Редакция от ${formatDate(doc.updatedAt)} · версия ${esc(LEGAL_DOCS_VERSION)}</p>
    </div>

    <div class="doc-layout">
      <aside class="doc-aside">
        <nav class="doc-nav" aria-label="Правовые документы">
${nav}
        </nav>
        <nav class="doc-toc" aria-label="Содержание документа">
          <h4>Содержание</h4>
${toc}
        </nav>
      </aside>

      <article class="doc-body">
${body}

        <div class="doc-operator">
          <h4>Оператор</h4>
          <p>${esc(legalOperator.legalNameRu)} («${esc(legalOperator.brandNameRu)}»)</p>
          <p>ИНН ${esc(legalOperator.inn)} · ОГРН ${esc(legalOperator.ogrn)}</p>
          <p>${esc(legalOperator.addressRu)}</p>
          <p>
            <a href="mailto:${esc(legalOperator.privacyEmail)}">${esc(legalOperator.privacyEmail)}</a> ·
            <a href="mailto:${esc(legalOperator.supportEmail)}">${esc(legalOperator.supportEmail)}</a>
          </p>
        </div>
      </article>
    </div>
  </div>
</main>

<footer>
  <div class="container foot-in">
    <div class="brand">
      <img src="/assets/logo.png" alt="Веллекс" width="32" height="32">
      <span>ВЕЛЛЕКС</span>
    </div>
    <nav class="foot-links">
${legalSlugs.map((s) => `      <a href="${legalRoutes[s].path}">${esc(legalRoutes[s].titleRu)}</a>`).join('\n')}
      <a href="#" id="cookie-settings-link">Настройки cookie</a>
    </nav>
    <p class="mono foot-copy">© ${new Date().getUTCFullYear()} ВЕЛЛЕКС · Игровая валюта WX · 18+</p>
  </div>
</footer>
${cookieBanner}
</div>
<script src="/assets/consent.js" defer></script>
</body>
</html>
`;
}

/* ── 3. запись ── */
mkdirSync(resolve(out, 'legal'), { recursive: true });
for (const slug of legalSlugs) {
  const file = resolve(out, 'legal', `${slug}.html`);
  writeFileSync(file, renderPage(slug));
  console.log(`✓ legal/${slug}.html  →  ${legalRoutes[slug].path}`);
}
console.log(`\nВерсия документов: ${LEGAL_DOCS_VERSION}`);
