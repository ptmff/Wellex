import { Search, Bell, Wallet, Menu, X, LogOut, User } from "lucide-react";
import { FormEvent, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";
import { isStaffRole } from "@/lib/money";
import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/api/notifications";
import { formatRelativeTime } from "@/lib/date";

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const { user, logout, request } = useAuth();
  const { language, setLanguage, t } = useI18n();
  const queryClient = useQueryClient();
  const navLinks = [
    { label: t("nav.markets"), path: "/" },
    { label: t("nav.portfolio"), path: "/portfolio" },
    { label: t("nav.shop"), path: "/shop" },
    { label: language === "ru" ? "Лидеры" : "Leaders", path: "/leaderboard" },
    ...(isStaffRole(user?.role) ? [{ label: t("nav.create"), path: "/create" }] : []),
  ];

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: () => listNotifications(request),
    enabled: !!user,
    refetchInterval: 20_000,
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(request),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const unread = notificationsQuery.data?.unread ?? 0;

  const submitSearch = (e: FormEvent) => {
    e.preventDefault();
    const q = search.trim();
    navigate(q ? `/?q=${encodeURIComponent(q)}` : "/");
    setSearchOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 glass border-b border-border/30">
      <div className="container flex h-14 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">P</span>
          </div>
          <span className="font-semibold text-foreground hidden sm:inline">Wellex</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((link) => {
            const active = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={`relative px-3 py-1.5 text-sm font-medium rounded-lg transition-colors duration-200 ${
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {link.label}
                {active && (
                  <motion.div
                    layoutId="nav-indicator"
                    className="absolute inset-0 rounded-lg bg-accent"
                    style={{ zIndex: -1 }}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <AnimatePresence>
            {searchOpen && (
              <motion.form
                onSubmit={submitSearch}
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 200, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <input
                  autoFocus
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("nav.searchMarkets")}
                  className="w-full bg-secondary text-sm text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary/50"
                />
              </motion.form>
            )}
          </AnimatePresence>

          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            type="button"
          >
            <Search className="h-4 w-4" />
          </button>

          {user ? (
            <div className="relative hidden sm:block">
              <button
                type="button"
                onClick={() => setBellOpen((v) => !v)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative"
              >
                <Bell className="h-4 w-4" />
                {unread > 0 ? (
                  <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                ) : null}
              </button>
              {bellOpen ? (
                <div className="absolute right-0 mt-2 w-80 rounded-xl border border-border/50 bg-card shadow-lg p-2 z-50">
                  <div className="flex items-center justify-between px-2 py-1 mb-1">
                    <span className="text-xs font-semibold">{language === "ru" ? "Уведомления" : "Notifications"}</span>
                    <button
                      type="button"
                      className="text-[11px] text-muted-foreground hover:text-foreground"
                      onClick={() => markAll.mutate()}
                    >
                      {language === "ru" ? "Прочитать все" : "Mark all read"}
                    </button>
                  </div>
                  <div className="max-h-72 overflow-y-auto">
                    {(notificationsQuery.data?.items ?? []).length === 0 ? (
                      <div className="text-xs text-muted-foreground px-2 py-6 text-center">
                        {language === "ru" ? "Пока пусто" : "Nothing yet"}
                      </div>
                    ) : (
                      (notificationsQuery.data?.items ?? []).map((n) => (
                        <button
                          key={n.id}
                          type="button"
                          className={`w-full text-left px-2 py-2 rounded-lg mb-1 ${n.read ? "opacity-70" : "bg-accent/40"}`}
                          onClick={() => {
                            void markNotificationRead(request, n.id).then(() =>
                              queryClient.invalidateQueries({ queryKey: ["notifications"] }),
                            );
                            const payload = n.payload as { marketId?: string } | null;
                            if (payload?.marketId) navigate(`/market/${payload.marketId}`);
                            setBellOpen(false);
                          }}
                        >
                          <div className="text-xs font-medium">{n.title}</div>
                          <div className="text-[11px] text-muted-foreground">{n.body}</div>
                          <div className="text-[10px] text-muted-foreground mt-0.5">{formatRelativeTime(n.createdAt)}</div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <button className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative hidden sm:flex" type="button" disabled>
              <Bell className="h-4 w-4" />
            </button>
          )}

          <div className="hidden sm:flex items-center rounded-lg bg-secondary p-0.5">
            <button
              type="button"
              onClick={() => setLanguage("ru")}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                language === "ru" ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              {t("lang.ru")}
            </button>
            <button
              type="button"
              onClick={() => setLanguage("en")}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                language === "en" ? "bg-card text-foreground" : "text-muted-foreground"
              }`}
            >
              {t("lang.en")}
            </button>
          </div>

          <Link
            to={user ? "/profile" : "/login"}
            className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg bg-accent hover:bg-accent/80 transition-colors text-sm font-medium"
          >
            {user ? <Wallet className="h-4 w-4" /> : <User className="h-4 w-4" />}
            <span>{user ? user.displayName ?? user.username : t("nav.login")}</span>
          </Link>

          {user ? (
            <button
              onClick={() => logout()}
              className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-transparent hover:bg-accent/50 transition-colors text-sm font-medium text-muted-foreground hover:text-foreground"
              type="button"
            >
              <LogOut className="h-4 w-4" />
              <span>{t("nav.logout")}</span>
            </button>
          ) : null}

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            type="button"
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden border-t border-border/30"
          >
            <nav className="container py-3 flex flex-col gap-1">
              <form onSubmit={submitSearch} className="px-3 pb-2">
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("nav.searchMarkets")}
                  className="w-full bg-secondary text-sm rounded-lg px-3 py-2 outline-none"
                />
              </form>
              <div className="flex gap-2 px-3 py-2">
                <button
                  type="button"
                  onClick={() => setLanguage("ru")}
                  className={`px-2 py-1 text-xs rounded-md ${
                    language === "ru" ? "bg-accent text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t("lang.ru")}
                </button>
                <button
                  type="button"
                  onClick={() => setLanguage("en")}
                  className={`px-2 py-1 text-xs rounded-md ${
                    language === "en" ? "bg-accent text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {t("lang.en")}
                </button>
              </div>
              {navLinks.map((link) => (
                <Link
                  key={link.path}
                  to={link.path}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    location.pathname === link.path
                      ? "bg-accent text-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
