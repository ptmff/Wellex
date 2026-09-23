import type { LegalSlug } from "../config";
import type { LegalDocumentContent } from "./types";
import { cookiePolicyEn, cookiePolicyRu } from "./cookiePolicy";
import { marketRulesEn, marketRulesRu } from "./marketRules";
import { privacyPolicyEn, privacyPolicyRu } from "./privacyPolicy";
import { termsOfUseEn, termsOfUseRu } from "./termsOfUse";

export function getLegalDocument(slug: LegalSlug, language: "ru" | "en"): LegalDocumentContent | null {
  const map: Record<LegalSlug, { ru: LegalDocumentContent; en: LegalDocumentContent }> = {
    privacy: { ru: privacyPolicyRu, en: privacyPolicyEn },
    terms: { ru: termsOfUseRu, en: termsOfUseEn },
    cookies: { ru: cookiePolicyRu, en: cookiePolicyEn },
    "market-rules": { ru: marketRulesRu, en: marketRulesEn },
  };
  const entry = map[slug];
  if (!entry) return null;
  return language === "ru" ? entry.ru : entry.en;
}

export const legalSlugs: LegalSlug[] = ["privacy", "terms", "cookies", "market-rules"];
