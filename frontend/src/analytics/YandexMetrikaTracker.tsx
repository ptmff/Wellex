import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import type { ConsentState } from "@/hooks/useCookieConsent";
import { hitYandexMetrika, initYandexMetrika, stopYandexMetrika } from "./yandexMetrika";

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
    return stopYandexMetrika;
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    hitYandexMetrika(location.pathname);
  }, [allowed, location.pathname]);

  return null;
}
