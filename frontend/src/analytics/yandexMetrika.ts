/** ID счётчика Яндекс.Метрики (можно переопределить через VITE_YANDEX_METRIKA_ID). */
export const YANDEX_METRIKA_COUNTER_ID = Number(
  import.meta.env.VITE_YANDEX_METRIKA_ID ?? "113005346",
);

declare global {
  interface Window {
    ym?: (counterId: number, method: string, ...args: unknown[]) => void;
    dataLayer?: Record<string, unknown>[];
  }
}

let scriptInjected = false;
let counterInitialized = false;

function injectMetrikaScript(): void {
  if (scriptInjected || typeof document === "undefined") return;
  scriptInjected = true;

  const tagUrl = `https://mc.yandex.ru/metrika/tag.js?id=${YANDEX_METRIKA_COUNTER_ID}`;

  (function (m, e, t, r, i, k, a) {
    const w = m as Window & { [key: string]: unknown };
    w[i] =
      w[i] ||
      function (...args: unknown[]) {
        const queue = (w[i] as { a?: unknown[] }).a ?? ((w[i] as { a: unknown[] }).a = []);
        queue.push(args);
      };
    (w[i] as { l?: number }).l = Date.now();
    for (let j = 0; j < document.scripts.length; j++) {
      if (document.scripts[j].src === r) return;
    }
    k = e.createElement(t);
    a = e.getElementsByTagName(t)[0];
    (k as HTMLScriptElement).async = true;
    (k as HTMLScriptElement).src = r;
    a.parentNode?.insertBefore(k, a);
  })(window, document, "script", tagUrl, "ym");
}

export function initYandexMetrika(): void {
  if (counterInitialized || !YANDEX_METRIKA_COUNTER_ID) return;

  injectMetrikaScript();
  window.dataLayer = window.dataLayer ?? [];

  window.ym?.(YANDEX_METRIKA_COUNTER_ID, "init", {
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: "dataLayer",
    referrer: document.referrer,
    url: location.href,
    accurateTrackBounce: true,
    trackLinks: true,
  });

  counterInitialized = true;
}

export function hitYandexMetrika(url: string, title?: string): void {
  if (!counterInitialized || !window.ym) return;
  window.ym(YANDEX_METRIKA_COUNTER_ID, "hit", url, { title: title ?? document.title });
}
