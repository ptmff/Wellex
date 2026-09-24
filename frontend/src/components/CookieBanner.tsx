import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cookie } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nContext";
import { legalRoutes } from "@/legal/config";
import { CookieSettingsDialog } from "./CookieSettingsDialog";
import { YandexMetrikaTracker } from "@/analytics/YandexMetrikaTracker";
import {
  acceptAll,
  acceptCustom,
  loadConsentState,
  rejectAll,
  type CookieConsent,
  type ConsentState,
} from "@/hooks/useCookieConsent";

type CookieConsentContextValue = {
  openCookieSettings: () => void;
  consentState: ConsentState;
};

const CookieConsentContext = createContext<CookieConsentContextValue | null>(null);

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

type BannerProps = {
  onConsent: (state: ConsentState) => void;
  onOpenSettings: () => void;
};

function CookieBanner({ onConsent, onOpenSettings }: BannerProps) {
  const { t, language } = useI18n();

  function handleAcceptAll() {
    onConsent(acceptAll());
  }

  function handleRejectAll() {
    onConsent(rejectAll());
  }

  const privacyLabel =
    language === "ru" ? legalRoutes.privacy.titleRu : legalRoutes.privacy.titleEn;
  const cookiesLabel =
    language === "ru" ? legalRoutes.cookies.titleRu : legalRoutes.cookies.titleEn;

  return (
    <motion.div
      initial={{ y: "100%", opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: "100%", opacity: 0 }}
      transition={{ type: "spring", damping: 30, stiffness: 300 }}
      className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-background/95 backdrop-blur-sm shadow-lg"
      role="region"
      aria-label={t("cookie.banner.ariaLabel")}
    >
      <div className="mx-auto max-w-5xl px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="space-y-1">
              <p className="text-sm font-medium leading-snug">{t("cookie.banner.title")}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {t("cookie.banner.description")}{" "}
                <Link to={legalRoutes.cookies.path} className="text-primary hover:underline">
                  {cookiesLabel}
                </Link>
                {" · "}
                <Link to={legalRoutes.privacy.path} className="text-primary hover:underline">
                  {privacyLabel}
                </Link>
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={onOpenSettings}>
              {t("cookie.banner.customize")}
            </Button>
            <Button variant="outline" size="sm" onClick={handleRejectAll}>
              {t("cookie.banner.rejectAll")}
            </Button>
            <Button size="sm" onClick={handleAcceptAll}>
              {t("cookie.banner.acceptAll")}
            </Button>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [consentState, setConsentState] = useState<ConsentState>(() => loadConsentState());
  const [settingsOpen, setSettingsOpen] = useState(false);

  const showBanner = consentState.status === "pending";

  const openCookieSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const initialConsent: CookieConsent =
    consentState.status === "accepted"
      ? consentState.consent
      : { necessary: true, analytics: false, functional: false };

  function handleSaveCustom(consent: CookieConsent) {
    setSettingsOpen(false);
    setConsentState(acceptCustom(consent));
  }

  const contextValue: CookieConsentContextValue = {
    openCookieSettings,
    consentState,
  };

  return (
    <CookieConsentContext.Provider value={contextValue}>
      <YandexMetrikaTracker consentState={consentState} />
      {children}
      <AnimatePresence>
        {showBanner ? (
          <CookieBanner
            key="cookie-banner"
            onConsent={setConsentState}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : null}
      </AnimatePresence>
      <CookieSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveCustom}
        initialConsent={initialConsent}
      />
    </CookieConsentContext.Provider>
  );
}
