import { Search, Bell, Wallet, Menu, X, LogOut, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/auth/AuthContext";
import { useI18n } from "@/i18n/I18nContext";

export function Navbar() {
  const location = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { user, logout } = useAuth();
  const { language, setLanguage, t } = useI18n();
  const navLinks = [
    { label: t("nav.markets"), path: "/" },
    { label: t("nav.portfolio"), path: "/portfolio" },
    { label: t("nav.create"), path: "/create" },
  ];

  return (
    <header className="sticky top-0 z-50 glass border-b border-border/30">
      <div className="container flex h-14 items-center justify-between gap-4">
        {/* Logo */}
        <Link to="/" className="flex items-center gap-2 shrink-0">
          <div className="h-7 w-7 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold text-sm">P</span>
          </div>
          <span className="font-semibold text-foreground hidden sm:inline">Wellex</span>
        </Link>

        {/* Desktop Nav */}
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

        {/* Right side */}
        <div className="flex items-center gap-2">
          <AnimatePresence>
            {searchOpen && (
              <motion.div
                initial={{ width: 0, opacity: 0 }}
                animate={{ width: 200, opacity: 1 }}
                exit={{ width: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <input
                  autoFocus
                  placeholder={t("nav.searchMarkets")}
                  className="w-full bg-secondary text-sm text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary/50"
                />
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={() => setSearchOpen(!searchOpen)}
            className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <Search className="h-4 w-4" />
          </button>

          <button className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors relative hidden sm:flex">
            <Bell className="h-4 w-4" />
            <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
          </button>

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
              onClick={() => {
                logout();
                // Keep user on current page; ProtectedRoute will redirect if needed.
              }}
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
          >
            {mobileMenuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Mobile dropdown */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden overflow-hidden border-t border-border/30"
          >
            <nav className="container py-3 flex flex-col gap-1">
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
