import { createContext, useContext } from "react";
import { loadConsentState, type ConsentState } from "./useCookieConsent";

type CookieConsentContextValue = {
  openCookieSettings: () => void;
  consentState: ConsentState;
};

export const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

export function useCookieConsentActions(): CookieConsentContextValue {
  const ctx = useContext(CookieConsentContext);
  if (!ctx) {
    return {
      openCookieSettings: () => {},
      consentState: loadConsentState(),
    };
  }
  return ctx;
}
