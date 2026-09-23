import { Link } from "react-router-dom";
import { useI18n } from "@/i18n/I18nContext";
import { legalOperator, legalRoutes } from "@/legal/config";
import { useCookieConsentActions } from "@/components/CookieBanner";

export function SiteFooter() {
  const { language } = useI18n();
  const { openCookieSettings } = useCookieConsentActions();

  const copy =
    language === "ru"
      ? "Торговля ведётся на игровую валюту WX и не является финансовой услугой или азартной игрой на реальные деньги. 18+."
      : "Trading uses in-game WX, not real money. 18+.";

  return (
    <footer className="border-t border-border/60 bg-muted/20 mt-8 hidden md:block">
      <div className="container py-8 pb-24 space-y-4">
        <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
          <Link to={legalRoutes.terms.path} className="text-muted-foreground hover:text-foreground">
            {language === "ru" ? legalRoutes.terms.titleRu : legalRoutes.terms.titleEn}
          </Link>
          <Link to={legalRoutes.privacy.path} className="text-muted-foreground hover:text-foreground">
            {language === "ru" ? legalRoutes.privacy.titleRu : legalRoutes.privacy.titleEn}
          </Link>
          <Link to={legalRoutes.cookies.path} className="text-muted-foreground hover:text-foreground">
            {language === "ru" ? legalRoutes.cookies.titleRu : legalRoutes.cookies.titleEn}
          </Link>
          <Link to={legalRoutes["market-rules"].path} className="text-muted-foreground hover:text-foreground">
            {language === "ru" ? legalRoutes["market-rules"].titleRu : legalRoutes["market-rules"].titleEn}
          </Link>
          <button
            type="button"
            onClick={openCookieSettings}
            className="text-muted-foreground hover:text-foreground"
          >
            {language === "ru" ? "Настройки cookie" : "Cookie settings"}
          </button>
        </div>
        <p className="text-[11px] text-muted-foreground max-w-2xl leading-relaxed">{copy}</p>
        <p className="text-[11px] text-muted-foreground">
          © {new Date().getFullYear()} {legalOperator.brandNameRu} ·{" "}
          <a href={`mailto:${legalOperator.supportEmail}`} className="hover:underline">
            {legalOperator.supportEmail}
          </a>
        </p>
      </div>
    </footer>
  );
}
