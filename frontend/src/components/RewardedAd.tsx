import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nContext";
import type { AdSession } from "@/api/economy";

declare global {
  interface Window {
    yaContextCb?: Array<() => void>;
    Ya?: {
      Context?: {
        AdvManager?: {
          render: (options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const YANDEX_CONTEXT_SRC = "https://yandex.ru/ads/system/context.js";

function ensureYandexLoader(): void {
  window.yaContextCb = window.yaContextCb ?? [];
  if (document.querySelector(`script[src="${YANDEX_CONTEXT_SRC}"]`)) return;
  const script = document.createElement("script");
  script.src = YANDEX_CONTEXT_SRC;
  script.async = true;
  document.head.appendChild(script);
}

type RewardedAdProps = {
  session: AdSession;
  claiming: boolean;
  /** Called when the ad has been fully watched and the reward can be claimed. */
  onComplete: () => void;
  onCancel: () => void;
};

/**
 * Rewarded ad player.
 *
 * - provider "yandex": renders a Yandex Advertising Network (РСЯ) rewarded
 *   block via Yandex.RTB and claims the reward on the onRewarded callback.
 *   Requires the site to be approved in РСЯ and AD_PROVIDER=yandex +
 *   YANDEX_RTB_BLOCK_ID on the backend.
 * - provider "mock": local countdown timer (used while there is no real
 *   ad network, e.g. on localhost).
 */
export function RewardedAd({ session, claiming, onComplete, onCancel }: RewardedAdProps) {
  if (session.provider === "yandex" && session.blockId) {
    return (
      <YandexRewarded
        blockId={session.blockId}
        claiming={claiming}
        onComplete={onComplete}
        onCancel={onCancel}
      />
    );
  }

  return (
    <MockRewarded
      seconds={Math.max(session.minWatchSeconds, 15)}
      claiming={claiming}
      onComplete={onComplete}
      onCancel={onCancel}
    />
  );
}

function MockRewarded({
  seconds,
  claiming,
  onComplete,
  onCancel,
}: {
  seconds: number;
  claiming: boolean;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { language } = useI18n();
  const [secondsLeft, setSecondsLeft] = useState(seconds);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const t = window.setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [secondsLeft]);

  return (
    <div className="rounded-lg bg-secondary p-6 text-center">
      <div className="text-3xl font-bold mb-1">{secondsLeft > 0 ? secondsLeft : "✓"}</div>
      <div className="text-xs text-muted-foreground mb-4">
        {language === "ru" ? "Имитация рекламного ролика" : "Simulated ad playback"}
      </div>
      {secondsLeft <= 0 ? (
        <Button onClick={onComplete} disabled={claiming}>
          {claiming
            ? language === "ru" ? "Начисляем..." : "Claiming..."
            : language === "ru" ? "Забрать награду" : "Claim reward"}
        </Button>
      ) : (
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {language === "ru" ? "Отмена" : "Cancel"}
        </Button>
      )}
    </div>
  );
}

function YandexRewarded({
  blockId,
  claiming,
  onComplete,
  onCancel,
}: {
  blockId: string;
  claiming: boolean;
  onComplete: () => void;
  onCancel: () => void;
}) {
  const { language } = useI18n();
  const [state, setState] = useState<"loading" | "rewarded" | "error">("loading");
  const startedRef = useRef(false);
  const claimedRef = useRef(false);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    let disposed = false;
    ensureYandexLoader();

    window.yaContextCb!.push(() => {
      window.Ya?.Context?.AdvManager?.render({
        blockId,
        type: "rewarded",
        onRewarded: (rewarded: boolean) => {
          if (disposed) return;
          if (rewarded) setState("rewarded");
        },
        onClose: () => {
          if (disposed) return;
          setState((s) => (s === "rewarded" ? s : "error"));
        },
        onError: () => {
          if (disposed) return;
          setState("error");
        },
      });
    });

    return () => {
      disposed = true;
    };
  }, [blockId]);

  useEffect(() => {
    if (state !== "rewarded" || claimedRef.current) return;
    claimedRef.current = true;
    onCompleteRef.current();
  }, [state]);

  if (state === "error") {
    return (
      <div className="rounded-lg bg-secondary p-6 text-center">
        <div className="text-sm text-muted-foreground mb-3">
          {language === "ru"
            ? "Не удалось показать рекламу. Попробуйте позже."
            : "Failed to show the ad. Try again later."}
        </div>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          {language === "ru" ? "Закрыть" : "Close"}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-secondary p-6 text-center">
      <div className="text-sm text-muted-foreground">
        {state === "rewarded"
          ? claiming
            ? language === "ru" ? "Начисляем награду..." : "Claiming reward..."
            : language === "ru" ? "Награда получена" : "Reward earned"
          : language === "ru" ? "Загружаем рекламу..." : "Loading ad..."}
      </div>
    </div>
  );
}
