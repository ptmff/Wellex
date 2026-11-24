/** ID счётчика Яндекс.Метрики (можно переопределить через VITE_YANDEX_METRIKA_ID). */
const counterId = Number(import.meta.env.VITE_YANDEX_METRIKA_ID ?? "113005346");
const tagUrl = `https://mc.yandex.ru/metrika/tag.js?id=${counterId}`;

type Metrika = ((id: number, method: string, ...args: unknown[]) => void) & {
  a?: unknown[][];
  l?: number;
};

declare global {
  interface Window {
    ym?: Metrika;
    dataLayer?: Record<string, unknown>[];
  }
}

let counterInitialized = false;
let pendingMetrika: Metrika | undefined;

function injectMetrikaScript() {
  if (!window.ym) {
    const queue: Metrika = (...args: unknown[]) => {
      (queue.a ??= []).push(args);
    };
    queue.l = Date.now();
    window.ym = pendingMetrika = queue;
  }

  if (Array.from(document.scripts).some((script) => script.src === tagUrl)) return;
  const script = document.createElement("script");
  script.async = true;
  script.src = tagUrl;
  script.addEventListener("error", () => script.remove(), { once: true });
  document.head.append(script);
}

export function initYandexMetrika() {
  if (counterInitialized || !counterId) return;
  injectMetrikaScript();
  window.dataLayer ??= [];
  window.ym?.(counterId, "init", {
    defer: true,
    ssr: true,
    webvisor: true,
    clickmap: true,
    ecommerce: "dataLayer",
    accurateTrackBounce: true,
    trackLinks: true,
  });
  counterInitialized = true;
}

export function stopYandexMetrika() {
  if (!counterInitialized) return;
  if (pendingMetrika && window.ym === pendingMetrika) {
    pendingMetrika.a = pendingMetrika.a?.filter((call) => call[0] !== counterId);
  } else {
    window.ym?.(counterId, "destruct");
  }
  counterInitialized = false;
}

export function hitYandexMetrika(path: string) {
  if (counterInitialized) window.ym?.(counterId, "hit", path, { title: document.title });
}
