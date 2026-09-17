import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/I18nContext";
import { CookieSettingsDialog } from "./CookieSettingsDialog";
import {
  acceptAll,
  acceptCustom,
  loadConsentState,
  rejectAll,
  type CookieConsent,
  type ConsentState,
} from "@/hooks/useCookieConsent";

type Props = {
  onConsent: (state: ConsentState) => void;
};

export function CookieBanner({ onConsent }: Props) {
  const { t } = useI18n();
  const [settingsOpen, setSettingsOpen] = useState(false);

  function handleAcceptAll() {
    onConsent(acceptAll());
  }

  function handleRejectAll() {
    onConsent(rejectAll());
  }

  function handleSaveCustom(consent: CookieConsent) {
    setSettingsOpen(false);
    onConsent(acceptCustom(consent));
  }

  return (
    <>
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
            {/* Text */}
            <div className="flex items-start gap-3">
              <Cookie className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="space-y-0.5">
                <p className="text-sm font-medium leading-snug">{t("cookie.banner.title")}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {t("cookie.banner.description")}
                </p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}>
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

      <CookieSettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSaveCustom}
        initialConsent={{ necessary: true, analytics: false, functional: false }}
      />
    </>
  );
}

/** Wrapper that handles visibility state. Mount once inside the app tree. */
export function CookieConsentProvider() {
  const [consentState, setConsentState] = useState<ConsentState>(() => loadConsentState());

  const show = consentState.status === "pending";

  return (
    <AnimatePresence>
      {show && <CookieBanner key="cookie-banner" onConsent={setConsentState} />}
    </AnimatePresence>
  );
}
