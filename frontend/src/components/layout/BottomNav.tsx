import { Home, BarChart3, PlusCircle, User, Briefcase } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useI18n } from "@/i18n/I18nContext";

export function BottomNav() {
  const location = useLocation();
  const { t } = useI18n();
  const items = [
    { icon: Home, label: t("nav.markets"), path: "/" },
    { icon: Briefcase, label: t("nav.portfolio"), path: "/portfolio" },
    { icon: PlusCircle, label: t("nav.create"), path: "/create" },
    { icon: User, label: t("nav.profile"), path: "/profile" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 glass border-t border-border/30">
      <div className="flex items-center justify-around h-14">
        {items.map((item) => {
          const active = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
