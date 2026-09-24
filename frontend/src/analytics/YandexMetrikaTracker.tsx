import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { ConsentState } from "@/hooks/useCookieConsent";
import { hitYandexMetrika, initYandexMetrika } from "./yandexMetrika";

function analyticsAllowed(consentState: ConsentState): boolean {
  return consentState.status === "accepted" && consentState.consent.analytics;
}

type Props = {
  consentState: ConsentState;
};

/** Подключает Яндекс.Метрику только при согласии на аналитические cookie. */
export function YandexMetrikaTracker({ consentState }: Props) {
  const location = useLocation();
  const allowed = analyticsAllowed(consentState);

  useEffect(() => {
    if (!allowed) return;
    initYandexMetrika();
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    const url = `${location.pathname}${location.search}${location.hash}`;
    hitYandexMetrika(url);
  }, [allowed, location.pathname, location.search, location.hash]);

  return null;
}
