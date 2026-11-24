import { createContext, useContext } from "react";
import type { Language } from "./translations";

export type I18nContextValue = {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: (key: string, fallback?: string) => string;
};

export const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used within I18nProvider");
  return context;
}
