import { useCallback, useRef, useState, type ReactNode } from "react";
import { Cookie } from "lucide-react";
import { CookieConsentContext } from "@/hooks/useCookieConsentActions";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";
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
    <div
      className="border-b border-border bg-card pt-[env(safe-area-inset-top)]"
      role="region"
      aria-label={t("cookie.banner.ariaLabel")}
    >
      <div className="container py-3">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
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

          <div className="flex flex-wrap items-center gap-1 sm:gap-2 lg:shrink-0">
            <Button variant="ghost" size="sm" className="min-h-10" onClick={onOpenSettings}>
              {t("cookie.banner.customize")}
            </Button>
            <Button variant="outline" size="sm" className="min-h-10" onClick={handleRejectAll}>
              {t("cookie.banner.rejectAll")}
            </Button>
            <Button size="sm" className="min-h-10" onClick={handleAcceptAll}>
              {t("cookie.banner.acceptAll")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CookieConsentProvider({ children }: { children: ReactNode }) {
  const [consentState, setConsentState] = useState<ConsentState>(() => loadConsentState());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsTrigger = useRef<HTMLElement | null>(null);

  const showBanner = consentState.status === "pending";

  const openCookieSettings = useCallback(() => {
    settingsTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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

  const contextValue = {
    openCookieSettings,
    consentState,
  };

  return (
    <CookieConsentContext.Provider value={contextValue}>
      <YandexMetrikaTracker consentState={consentState} />
      {showBanner && <CookieBanner onConsent={setConsentState} onOpenSettings={openCookieSettings} />}
      {children}
      {settingsOpen && (
        <CookieSettingsDialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          onSave={handleSaveCustom}
          initialConsent={initialConsent}
          restoreFocus={() => {
            const trigger = settingsTrigger.current;
            if (trigger?.isConnected) trigger.focus();
            else document.getElementById("main-content")?.focus();
          }}
        />
      )}
    </CookieConsentContext.Provider>
  );
}
