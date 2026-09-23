/** Версия пакета юридических документов (синхронизировать с backend/src/common/legal.constants.ts). */
export const LEGAL_DOCS_VERSION = "2026-03-23";

/**
 * Реквизиты оператора ПДн по 152-ФЗ. Замените на фактические перед публикацией.
 * В документах используются эти поля; без реальных данных политика формально неполная.
 */
export const legalOperator = {
  brandName: "Wellex",
  brandNameRu: "Веллекс",
  legalNameRu: "ООО «Веллекс»",
  inn: "8800555353",
  ogrn: "8800555353000",
  addressRu: "Российская Федерация, Москва, Башня Федерация, 4624",
  privacyEmail: "privacy@wellex.com",
  supportEmail: "hello@wellex.com",
} as const;

export type LegalSlug = "privacy" | "terms" | "cookies" | "market-rules";

export const legalRoutes: Record<
  LegalSlug,
  { path: string; titleKey: string; titleRu: string; titleEn: string }
> = {
  privacy: {
    path: "/legal/privacy",
    titleKey: "legal.privacy.title",
    titleRu: "Политика обработки персональных данных",
    titleEn: "Personal Data Processing Policy",
  },
  terms: {
    path: "/legal/terms",
    titleKey: "legal.terms.title",
    titleRu: "Пользовательское соглашение",
    titleEn: "Terms of Use",
  },
  cookies: {
    path: "/legal/cookies",
    titleKey: "legal.cookies.title",
    titleRu: "Политика использования cookie и локального хранилища",
    titleEn: "Cookie and Local Storage Policy",
  },
  "market-rules": {
    path: "/legal/market-rules",
    titleKey: "legal.marketRules.title",
    titleRu: "Правила рынков и торговли",
    titleEn: "Market and Trading Rules",
  },
};
