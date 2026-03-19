import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { User, Settings, LogOut, Shield, Bell, ExternalLink } from "lucide-react";
import { AppLayout } from "@/components/layout/AppLayout";
import { useAuth } from "@/auth/AuthContext";
import type { PaginatedResult, PortfolioSummaryResponse, PortfolioTrade } from "@/lib/portfolio";

function formatRelativeTime(iso: string): string {
  const ts = new Date(iso).getTime();
  const diffMs = Date.now() - ts;
  const minutes = Math.max(0, Math.floor(diffMs / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function Profile() {
  const { user, request, logout } = useAuth();

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
      : "Failed to load trades"
    : null;

  const errorMessage =
    isError && error
      ? typeof (error as { message?: unknown }).message === "string"
        ? (error as { message?: unknown }).message
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
  const totalPnlText = `${stats.totalPnl >= 0 ? "+" : ""}$${Math.abs(stats.totalPnl).toLocaleString()}`;

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold mb-6">Profile</h1>

        {/* User card */}
        <div className="rounded-xl bg-card border border-border/50 p-5 mb-6">
          <div className="flex items-center gap-4">
            <div className="h-14 w-14 rounded-full bg-primary/15 flex items-center justify-center">
              <User className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">{user?.displayName ?? user?.username ?? "User"}</h2>
              <p className="text-xs text-muted-foreground">
                @{user?.username ?? "unknown"} • {user?.role ?? "user"}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-5">
            <div className="text-center p-3 rounded-lg bg-secondary/50">
              <div className="text-lg font-bold">${stats.totalBalance.toLocaleString()}</div>
              <div className="text-[11px] text-muted-foreground">Total Balance</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary/50">
              <div className={`text-lg font-bold ${totalPnlClass}`}>{totalPnlText}</div>
              <div className="text-[11px] text-muted-foreground">Total P&amp;L</div>
            </div>
            <div className="text-center p-3 rounded-lg bg-secondary/50">
              <div className="text-lg font-bold">{stats.openPositions}</div>
              <div className="text-[11px] text-muted-foreground">Open Positions</div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Activity */}
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <h2 className="text-sm font-semibold mb-3">Recent Activity</h2>
            <div className="space-y-2">
              {isTradesLoading ? (
                <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
              ) : isTradesError ? (
                <div className="text-sm text-destructive py-4 text-center">{tradesErrorMessage ?? "Failed to load"}</div>
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
                        {t.side === "yes" ? "YES" : "NO"} trade
                      </div>
                      <div className="text-xs text-muted-foreground">{t.marketTitle}</div>
                      <div className="text-xs text-muted-foreground">
                        {Math.round(t.price * 100)}¢ @ {t.quantity} shares
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-medium">
                        ${t.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
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
            <h2 className="text-sm font-semibold mb-3">Settings</h2>
            <div className="space-y-1">
              {[
                { icon: Bell, label: "Notifications", desc: "Manage alerts" },
                { icon: Shield, label: "Security", desc: "2FA and passwords" },
                { icon: ExternalLink, label: "Connected Apps", desc: "Manage integrations" },
                { icon: Settings, label: "Preferences", desc: "Language, display" },
              ].map((item) => (
                <button
                  key={item.label}
                  className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-secondary/50 transition-colors"
                >
                  <item.icon className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">{item.label}</div>
                    <div className="text-[11px] text-muted-foreground">{item.desc}</div>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={() => logout()}
                className="w-full flex items-center gap-3 p-3 rounded-lg text-left hover:bg-destructive/10 transition-colors text-danger"
              >
                <LogOut className="h-4 w-4" />
                <span className="text-sm font-medium">Log Out</span>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
