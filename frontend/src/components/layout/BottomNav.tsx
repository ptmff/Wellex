import { Home, User, Briefcase, Coins } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "@/i18n/useI18n";
import { useAuth } from "@/auth/useAuth";

export function BottomNav() {
  const location = useLocation();
  const { t, language } = useI18n();
  const { user } = useAuth();
  const items = [
    { icon: Home, label: t("nav.markets"), path: "/markets" },
    { icon: Briefcase, label: t("nav.portfolio"), path: "/portfolio" },
    { icon: Coins, label: t("nav.shop"), path: "/shop" },
    { icon: User, label: user ? t("nav.profile") : t("nav.login"), path: user ? "/profile" : "/login" },
  ];

  return (
    <nav aria-label={language === "ru" ? "Быстрая навигация" : "Quick navigation"} className="glass fixed inset-x-0 bottom-0 z-40 border-t border-border/30 pb-[env(safe-area-inset-bottom)] lg:hidden">
      <div className="grid min-h-14 grid-cols-4">
        {items.map((item) => {
          const active = location.pathname === item.path || (item.path === "/markets" && location.pathname.startsWith("/market/"));
          return (
            <Link
              key={item.path}
              to={item.path}
              aria-current={active ? "page" : undefined}
              className={`flex min-h-14 flex-col items-center justify-center gap-0.5 px-1 py-1 transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-center text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
