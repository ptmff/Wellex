export type CookieCategory = "necessary" | "analytics" | "functional";

export type CookieConsent = {
  necessary: boolean; // always true, cannot be disabled
  analytics: boolean;
  functional: boolean;
};

export type ConsentState =
  | { status: "pending" }
  | { status: "accepted"; consent: CookieConsent }
  | { status: "rejected" };

const STORAGE_KEY = "wellex-cookie-consent";

export function loadConsentState(): ConsentState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { status: "pending" };
    const stored = JSON.parse(raw) as ConsentState | null;
    if (stored?.status === "rejected") return stored;
    const consent = stored?.status === "accepted" ? stored.consent : undefined;
    if (typeof consent?.analytics === "boolean" && typeof consent.functional === "boolean") {
      return { status: "accepted", consent: { ...consent, necessary: true } };
    }
    return { status: "pending" };
  } catch {
    return { status: "pending" };
  }
}

export function saveConsentState(state: ConsentState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore
  }
}

export function acceptAll(): ConsentState {
  const state: ConsentState = {
    status: "accepted",
    consent: { necessary: true, analytics: true, functional: true },
  };
  saveConsentState(state);
  return state;
}

export function rejectAll(): ConsentState {
  const state: ConsentState = {
    status: "accepted",
    consent: { necessary: true, analytics: false, functional: false },
  };
  saveConsentState(state);
  return state;
}

export function acceptCustom(consent: CookieConsent): ConsentState {
  const state: ConsentState = {
    status: "accepted",
    // necessary is always forced to true
    consent: { ...consent, necessary: true },
  };
  saveConsentState(state);
  return state;
}

export function hasFunctionalConsent(): boolean {
  const state = loadConsentState();
  return state.status === "accepted" && state.consent.functional;
}

export function hasAnalyticsConsent(): boolean {
  const state = loadConsentState();
  return state.status === "accepted" && state.consent.analytics;
}
