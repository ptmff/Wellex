import { useEffect, useMemo, useState } from "react";
import { hasFunctionalConsent } from "@/hooks/useCookieConsent";
import { dictionaries, type Language } from "./translations";
import { I18nContext, type I18nContextValue } from "./useI18n";

const STORAGE_KEY = "wellex-language";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ru");

  useEffect(() => {
    if (!hasFunctionalConsent()) return;
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ru" || stored === "en") {
      setLanguageState(stored);
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    if (hasFunctionalConsent()) {
      window.localStorage.setItem(STORAGE_KEY, nextLanguage);
    }
  };

  const value = useMemo<I18nContextValue>(() => {
    const locale = language === "ru" ? "ru-RU" : "en-US";
    const t = (key: string, fallback?: string) => dictionaries[language][key] ?? fallback ?? key;
    return { language, locale, setLanguage, t };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
