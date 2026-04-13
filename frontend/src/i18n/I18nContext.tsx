import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { dictionaries, type Language } from "./translations";

type I18nContextValue = {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: string, fallback?: string) => string;
};

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const STORAGE_KEY = "wellex-language";

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ru");

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "ru" || stored === "en") {
      setLanguageState(stored);
    }
  }, []);

  const setLanguage = (nextLanguage: Language) => {
    setLanguageState(nextLanguage);
    window.localStorage.setItem(STORAGE_KEY, nextLanguage);
  };

  const value = useMemo<I18nContextValue>(() => {
    const locale = language === "ru" ? "ru-RU" : "en-US";
    const t = (key: string, fallback?: string) => dictionaries[language][key] ?? fallback ?? key;
    return { language, locale, setLanguage, t };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
