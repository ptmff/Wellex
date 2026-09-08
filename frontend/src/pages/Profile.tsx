import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { User, Settings, LogOut, Shield, Bell, ExternalLink } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/auth/AuthContext";
import type { PaginatedResult, PortfolioSummaryResponse, PortfolioTrade } from "@/lib/portfolio";
import { formatRelativeTime } from "@/lib/date";
import { useI18n } from "@/i18n/I18nContext";
import { formatWx } from "@/lib/money";

export default function Profile() {
  const { user, request, logout } = useAuth();
  const { language, setLanguage } = useI18n();
  const [openPanel, setOpenPanel] = useState<"none" | "security" | "apps" | "prefs">("none");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [pwdMsg, setPwdMsg] = useState<string | null>(null);

  const { data: portfolio, isLoading: isPortfolioLoading, isError, error } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => request<PortfolioSummaryResponse>("/portfolio", { method: "GET" }),
  });

  const {
    data: tradeHistory,
    isLoading: isTradesLoading,
    isError: isTradesError,
    error: tradesError,
  } = useQuery({
    queryKey: ["portfolio-trades", "profile", 1, 5],
    queryFn: () =>
      request<PaginatedResult<PortfolioTrade>>("/portfolio/trades?page=1&limit=5", {
        method: "GET",
      }),
    staleTime: 1000 * 30,
  });

  const tradesErrorMessage = isTradesError
    ? typeof (tradesError as { message?: unknown }).message === "string"
      ? (tradesError as { message?: unknown }).message
      : language === "ru"
        ? "Не удалось загрузить сделки"
        : "Failed to load trades"
    : null;

  const errorMessage =
    isError && error
      ? typeof (error as { message?: unknown }).message === "string"
        ? (error as { message?: unknown }).message
        : language === "ru"
          ? "Не удалось загрузить портфель"
          : "Failed to load portfolio"
      : null;

  const stats = useMemo(() => {
    if (!portfolio) {
      return {
        totalBalance: 0,
        totalPnl: 0,
        openPositions: 0,
      };
    }
    return {
      totalBalance: portfolio.balance.total,
      totalPnl: portfolio.pnl.total,
      openPositions: portfolio.positions.open,
    };
  }, [portfolio]);

  const totalPnlClass = stats.totalPnl >= 0 ? "text-success" : "text-danger";
  const totalPnlText = formatWx(stats.totalPnl, { signed: true });

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold mb-6">{language === "ru" ? "Профиль" : "Profile"}</h1>

        {/* User card */}
        <div className="rounded-xl bg-card border border-border/50 p-5 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{user?.displayName ?? user?.username ?? (language === "ru" ? "Пользователь" : "User")}</h2>
              <p className="text-xs text-muted-foreground">
                @{user?.username ?? (language === "ru" ? "неизвестно" : "unknown")} • {user?.role ?? "user"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5" id="profile-notifications">
            {isPortfolioLoading ? (
              <div className="col-span-3 text-center text-sm text-muted-foreground py-3">
                {language === "ru" ? "Загрузка баланса…" : "Loading balance…"}
              </div>
            ) : (
              <>
            <div className="text-center p-3 rounded-lg bg-secondary/50">
              <div className="text-lg font-bold">{formatWx(stats.totalBalance)}</div>
              <div className="text-[11px] text-muted-foreground">{language === "ru" ? "Общий баланс" : "Total Balance"}</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary/50">
              <div className={`text-lg font-bold ${totalPnlClass}`}>{totalPnlText}</div>
              <div className="text-[11px] text-muted-foreground">{language === "ru" ? "Общий P&L" : "Total P&L"}</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary/50">
              <div className="text-lg font-bold">{stats.openPositions}</div>
              <div className="text-[11px] text-muted-foreground">{language === "ru" ? "Открытые позиции" : "Open Positions"}</div>
            </div>
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity */}
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Последняя активность" : "Recent Activity"}</h2>
            <div className="space-y-2">
              {isTradesLoading ? (
                <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
              ) : isTradesError ? (
                <div className="text-sm text-destructive py-4 text-center">
                  {tradesErrorMessage ?? (language === "ru" ? "Не удалось загрузить" : "Failed to load")}
                </div>
              ) : (
                (tradeHistory?.data ?? []).map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0 }}
                    className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
                  >
                    <div>
                      <div className="text-sm font-medium">
                        {t.side === "yes" ? "YES" : "NO"} {language === "ru" ? "сделка" : "trade"}
                      </div>
                      <div className="text-xs text-muted-foreground">{t.marketTitle}</div>
                      <div className="text-xs text-muted-foreground">
                        {Math.round(t.price * 100)}¢ @ {t.quantity} {language === "ru" ? "акций" : "shares"}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        {formatWx(t.totalValue)}
                      </div>
                      <div className="text-[10px] text-muted-foreground">{formatRelativeTime(t.executedAt)}</div>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </div>

          {/* Settings */}
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Настройки" : "Settings"}</h2>
            <div className="space-y-1">
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-secondary/50 transition-colors"
                onClick={() => {
                  document.getElementById("profile-notifications")?.scrollIntoView({ behavior: "smooth" });
                }}
              >
                <Bell className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{language === "ru" ? "Уведомления" : "Notifications"}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {language === "ru" ? "Колокольчик в шапке: сделки и резолюции" : "Bell in the header: fills and resolutions"}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-secondary/50 transition-colors"
                onClick={() => setOpenPanel(openPanel === "security" ? "none" : "security")}
              >
                <Shield className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{language === "ru" ? "Безопасность" : "Security"}</div>
                  <div className="text-[11px] text-muted-foreground">{language === "ru" ? "Смена пароля" : "Change password"}</div>
                </div>
              </button>
              {openPanel === "security" ? (
                <form
                  className="px-3 pb-3 space-y-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setPwdMsg(null);
                    try {
                      await request("/auth/password", {
                        method: "PATCH",
                        body: { currentPassword, newPassword },
                        authRequired: true,
                      });
                      setPwdMsg(language === "ru" ? "Пароль обновлён" : "Password updated");
                      setCurrentPassword("");
                      setNewPassword("");
                    } catch (err) {
                      setPwdMsg(typeof (err as { message?: string }).message === "string"
                        ? (err as { message: string }).message
                        : language === "ru" ? "Не удалось сменить пароль" : "Failed to change password");
                    }
                  }}
                >
                  <input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder={language === "ru" ? "Текущий пароль" : "Current password"}
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm"
                  />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder={language === "ru" ? "Новый пароль" : "New password"}
                    className="w-full bg-secondary rounded-lg px-3 py-2 text-sm"
                  />
                  <button type="submit" className="text-sm font-medium text-primary">
                    {language === "ru" ? "Сохранить" : "Save"}
                  </button>
                  {pwdMsg ? <div className="text-xs text-muted-foreground">{pwdMsg}</div> : null}
                </form>
              ) : null}
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-secondary/50 transition-colors"
                onClick={() => setOpenPanel(openPanel === "apps" ? "none" : "apps")}
              >
                <ExternalLink className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{language === "ru" ? "Подключенные приложения" : "Connected Apps"}</div>
                  <div className="text-[11px] text-muted-foreground">{language === "ru" ? "OAuth-интеграции" : "OAuth integrations"}</div>
                </div>
              </button>
              {openPanel === "apps" ? (
                <p className="px-3 pb-3 text-xs text-muted-foreground">
                  {language === "ru"
                    ? "Сторонние приложения пока не подключаются. ЮKassa и РСЯ настраиваются на сервере, не в аккаунте."
                    : "No third-party apps yet. YooKassa and ads are configured on the server, not per account."}
                </p>
              ) : null}
              <button
                type="button"
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-secondary/50 transition-colors"
                onClick={() => setOpenPanel(openPanel === "prefs" ? "none" : "prefs")}
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                <div>
                  <div className="text-sm font-medium">{language === "ru" ? "Предпочтения" : "Preferences"}</div>
                  <div className="text-[11px] text-muted-foreground">{language === "ru" ? "Язык интерфейса" : "Interface language"}</div>
                </div>
              </button>
              {openPanel === "prefs" ? (
                <div className="px-3 pb-3 flex gap-2">
                  <button type="button" className={`px-3 py-1 rounded-lg text-xs ${language === "ru" ? "bg-accent" : "bg-secondary"}`} onClick={() => setLanguage("ru")}>RU</button>
                  <button type="button" className={`px-3 py-1 rounded-lg text-xs ${language === "en" ? "bg-accent" : "bg-secondary"}`} onClick={() => setLanguage("en")}>EN</button>
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => logout()}
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-destructive/10 transition-colors text-danger"
              >
                <LogOut className="h-4 w-4" />
                <span className="text-sm font-medium">{language === "ru" ? "Выйти" : "Log Out"}</span>
              </button>
            </div>
          </div>
        </div>
        {errorMessage ? <div className="mt-4 text-sm text-destructive">{errorMessage}</div> : null}
      </motion.div>
    </AppLayout>
  );
}
