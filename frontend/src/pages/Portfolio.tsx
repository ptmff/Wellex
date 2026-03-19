import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { useAuth } from "@/auth/AuthContext";

const portfolioHistory = Array.from({ length: 30 }, (_, i) => {
  const d = new Date();
  d.setDate(d.getDate() - (29 - i));
  return {
    time: d.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    value: 4200 + Math.sin(i / 4) * 300 + i * 15 + Math.random() * 100,
  };
});

type PortfolioSummary = {
  balance: { available: number; reserved: number; total: number; currency: string };
  pnl: { realized: number; unrealized: number; total: number };
  positions: { count: number; open: number; totalInvested: number };
  recentTrades: Array<unknown>;
};

type ApiPosition = {
  id: string;
  marketId: string;
  marketTitle: string;
  side: "yes" | "no";
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
};

export default function Portfolio() {
  const { request } = useAuth();

  const { data: portfolio, isLoading: isPortfolioLoading, isError: isPortfolioError, error: portfolioError } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => request<PortfolioSummary>("/portfolio", { method: "GET" }),
  });

  const { data: apiPositions, isLoading: isPositionsLoading, isError: isPositionsError, error: positionsError } = useQuery({
    queryKey: ["portfolio-positions"],
    queryFn: () => request<ApiPosition[]>("/portfolio/positions", { method: "GET" }),
  });

  const errorMessage = isPortfolioError
    ? typeof (portfolioError as { message?: unknown }).message === "string"
      ? (portfolioError as { message?: unknown }).message
      : "Failed to load portfolio"
    : isPositionsError
      ? typeof (positionsError as { message?: unknown }).message === "string"
        ? (positionsError as { message?: unknown }).message
        : "Failed to load positions"
      : null;

  const totalBalance = portfolio?.balance.total ?? 0;
  const totalPnl = portfolio?.pnl.total ?? 0;
  const isPnlPositive = totalPnl >= 0;
  const pnlPercent = (() => {
    const invested = portfolio?.positions.totalInvested ?? 0;
    if (!invested) return 0;
    return (totalPnl / invested) * 100;
  })();

  const positions = (apiPositions ?? []).map((p) => ({
    marketId: p.marketId,
    marketTitle: p.marketTitle,
    side: p.side === "yes" ? ("YES" as const) : ("NO" as const),
    shares: p.quantity,
    avgPrice: p.averagePrice,
    currentPrice: p.currentPrice,
    pnl: p.unrealizedPnl,
    pnlPercent: p.unrealizedPnlPct,
  }));

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold mb-6">Portfolio</h1>

        {/* Balance cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Balance</div>
            <div className="text-2xl font-bold">${totalBalance.toLocaleString()}</div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
            <div className="flex items-center gap-1.5">
              <span className={`text-2xl font-bold ${isPnlPositive ? "text-success" : "text-danger"}`}>
                {isPnlPositive ? "+" : "-"}${Math.abs(totalPnl).toLocaleString()}
              </span>
              <span
                className={`flex items-center text-xs ${
                  isPnlPositive ? "text-success bg-success/10" : "text-danger bg-danger/10"
                } px-1.5 py-0.5 rounded-md font-medium`}
              >
                {isPnlPositive ? (
                  <ArrowUpRight className="h-3 w-3" />
                ) : (
                  <ArrowDownRight className="h-3 w-3" />
                )}
                {pnlPercent}%
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
            <div className="text-2xl font-bold">{portfolio?.positions.open ?? 0}</div>
          </div>
        </div>

        {/* Performance chart */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">Performance</h2>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={portfolioHistory}>
              <defs>
                <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(160, 84%, 44%)" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="hsl(160, 84%, 44%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 16%)" />
              <XAxis dataKey="time" tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`} />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(225, 15%, 11%)",
                  border: "1px solid hsl(225, 12%, 16%)",
                  borderRadius: "8px",
                  fontSize: "12px",
                }}
                labelStyle={{ color: "hsl(215, 12%, 50%)" }}
                formatter={(v: number) => [`$${v.toFixed(0)}`, "Value"]}
              />
              <Area type="monotone" dataKey="value" stroke="hsl(160, 84%, 44%)" strokeWidth={2} fill="url(#portfolioGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Positions */}
        <div className="rounded-xl bg-card border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-3">Open Positions</h2>
          <div className="space-y-2">
            {isPortfolioLoading || isPositionsLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : errorMessage ? (
              <div className="text-sm text-destructive py-4 text-center">{errorMessage}</div>
            ) : (
              positions.map((pos, i) => (
                <motion.div
                  key={pos.marketId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/50 hover:bg-secondary transition-colors"
                >
                  <div className="flex-1 min-w-0 mr-4">
                    <div className="text-sm font-medium truncate">{pos.marketTitle}</div>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      <span className={pos.side === "YES" ? "text-success font-medium" : "text-danger font-medium"}>
                        {pos.side}
                      </span>
                      <span>
                        {pos.shares} shares @ {pos.avgPrice}¢
                      </span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div
                      className={`text-sm font-semibold flex items-center gap-1 ${pos.pnl >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {pos.pnl >= 0 ? (
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownRight className="h-3.5 w-3.5" />
                      )}
                      ${Math.abs(pos.pnl)}
                    </div>
                    <div className={`text-[11px] ${pos.pnl >= 0 ? "text-success" : "text-danger"}`}>
                      {pos.pnlPercent > 0 ? "+" : ""}
                      {pos.pnlPercent}%
                    </div>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
