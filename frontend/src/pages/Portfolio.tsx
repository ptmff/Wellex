import { useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolioWebSocket } from "@/hooks/usePortfolioWebSocket";
import type {
  PaginatedResult,
  PortfolioBalanceTx,
  PortfolioPnlEndpointResponse,
  PortfolioPosition,
  PortfolioSummaryResponse,
  PortfolioTrade,
} from "@/lib/portfolio";
import { formatDateToLocaleDateString, formatDateToLocaleString, parseDate } from "@/lib/date";

type ChartPoint = {
  time: string;
  value: number;
};

export default function Portfolio() {
  const { request, user } = useAuth();

  const [tradesPage, setTradesPage] = useState(1);
  const tradesLimit = 10;

  const [balanceHistoryPage] = useState(1);
  const balanceHistoryLimit = 50;

  const {
    data: portfolio,
    isLoading: isPortfolioLoading,
    isError: isPortfolioError,
    error: portfolioError,
  } = useQuery({
    queryKey: ["portfolio"],
    queryFn: () => request<PortfolioSummaryResponse>("/portfolio", { method: "GET" }),
  });

  const {
    data: apiPositions,
    isLoading: isPositionsLoading,
    isError: isPositionsError,
    error: positionsError,
  } = useQuery({
    queryKey: ["portfolio-positions"],
    queryFn: () => request<PortfolioPosition[]>("/portfolio/positions", { method: "GET" }),
  });

  const marketIds = useMemo(() => (apiPositions ?? []).map((p) => p.marketId), [apiPositions]);
  usePortfolioWebSocket({ enabled: !!user, marketIds });

  const {
    data: pnlSummary,
    isLoading: isPnlLoading,
    isError: isPnlError,
    error: pnlError,
  } = useQuery({
    queryKey: ["portfolio-pnl"],
    queryFn: () => request<PortfolioPnlEndpointResponse>("/portfolio/pnl", { method: "GET" }),
  });

  const {
    data: balanceHistory,
    isLoading: isBalanceLoading,
    isError: isBalanceError,
    error: balanceError,
  } = useQuery({
    queryKey: ["portfolio-balance-history", balanceHistoryPage, balanceHistoryLimit],
    queryFn: () =>
      request<PaginatedResult<PortfolioBalanceTx>>(
        `/portfolio/balance-history?page=${balanceHistoryPage}&limit=${balanceHistoryLimit}`,
        { method: "GET" },
      ),
  });

  const {
    data: tradeHistory,
    isLoading: isTradesLoading,
    isError: isTradesError,
    error: tradesError,
  } = useQuery({
    queryKey: ["portfolio-trades", tradesPage, tradesLimit],
    queryFn: () =>
      request<PaginatedResult<PortfolioTrade>>(`/portfolio/trades?page=${tradesPage}&limit=${tradesLimit}`, {
        method: "GET",
      }),
    keepPreviousData: true,
  });

  const portfolioErrorMessage = isPortfolioError
    ? typeof (portfolioError as { message?: unknown }).message === "string"
      ? (portfolioError as { message?: unknown }).message
      : "Failed to load portfolio"
    : null;

  const positionsErrorMessage = isPositionsError
    ? typeof (positionsError as { message?: unknown }).message === "string"
      ? (positionsError as { message?: unknown }).message
      : "Failed to load positions"
    : null;

  const pnlErrorMessage = isPnlError
    ? typeof (pnlError as { message?: unknown }).message === "string"
      ? (pnlError as { message?: unknown }).message
      : "Failed to load PnL"
    : null;

  const balanceErrorMessage = isBalanceError
    ? typeof (balanceError as { message?: unknown }).message === "string"
      ? (balanceError as { message?: unknown }).message
      : "Failed to load balance history"
    : null;

  const tradesErrorMessage = isTradesError
    ? typeof (tradesError as { message?: unknown }).message === "string"
      ? (tradesError as { message?: unknown }).message
      : "Failed to load trades"
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
    id: p.id,
    marketId: p.marketId,
    marketTitle: p.marketTitle,
    side: p.side === "yes" ? ("YES" as const) : ("NO" as const),
    shares: p.quantity,
    avgPrice01: p.averagePrice,
    pnl: p.unrealizedPnl,
    pnlPercent: p.unrealizedPnlPct,
  }));

  const chartData: ChartPoint[] = useMemo(() => {
    const txs = balanceHistory?.data ?? [];

    return txs
      .map((tx, idx) => {
        const d = parseDate(tx.createdAt);
        return {
          time: d ? d.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBD",
          value: tx.balanceAfter,
          ts: d ? d.getTime() : idx, // fallback keeps chart usable even if date parsing fails
        };
      })
      .sort((a, b) => a.ts - b.ts)
      .map(({ time, value }) => ({ time, value }));
  }, [balanceHistory]);

  const recentBalances = useMemo(() => (balanceHistory?.data ?? []).slice(0, 10), [balanceHistory]);

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-2xl font-bold mb-6">Portfolio</h1>

        {/* Balance cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Total Balance</div>
            <div className="text-2xl font-bold">{isPortfolioLoading ? "…" : `$${totalBalance.toLocaleString()}`}</div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Total P&L</div>
            <div className="flex items-center gap-1.5">
              <span className={`text-2xl font-bold ${isPnlPositive ? "text-success" : "text-danger"}`}>
                {isPortfolioLoading ? "…" : `${isPnlPositive ? "+" : "-"}$${Math.abs(totalPnl).toLocaleString()}`}
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
                {isPortfolioLoading ? "—" : `${pnlPercent.toFixed(2)}%`}
              </span>
            </div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">Open Positions</div>
            <div className="text-2xl font-bold">{isPortfolioLoading ? "…" : portfolio?.positions.open ?? 0}</div>
          </div>
        </div>

        {/* Performance chart */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">Performance</h2>
          {isBalanceLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
          ) : balanceErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{balanceErrorMessage}</div>
          ) : chartData.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">No data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="portfolioGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="hsl(160, 84%, 44%)" stopOpacity={0.15} />
                    <stop offset="100%" stopColor="hsl(160, 84%, 44%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(225, 12%, 16%)" />
                <XAxis
                  dataKey="time"
                  tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(215, 12%, 50%)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${(v / 1000).toFixed(1)}K`}
                />
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
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(160, 84%, 44%)"
                  strokeWidth={2}
                  fill="url(#portfolioGrad)"
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Positions */}
        <div className="rounded-xl bg-card border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-3">Open Positions</h2>
          <div className="space-y-2">
            {isPortfolioLoading || isPositionsLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
            ) : portfolioErrorMessage || positionsErrorMessage ? (
              <div className="text-sm text-destructive py-4 text-center">{portfolioErrorMessage ?? positionsErrorMessage}</div>
            ) : (
              positions.map((pos, i) => (
                <motion.div
                  key={pos.id}
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
                        {pos.shares} shares @ {Math.round(pos.avgPrice01 * 100)}¢
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

        {/* PnL summary */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mt-6 mb-6">
          <h2 className="text-sm font-semibold mb-3">PnL Summary</h2>
          {isPnlLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
          ) : pnlErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{pnlErrorMessage}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl bg-secondary/30 border border-border/50 p-4">
                <div className="text-xs text-muted-foreground mb-2">Trading</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Trades</span>
                    <span className="font-medium">{pnlSummary?.trading.tradeCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Total traded</span>
                    <span className="font-medium">
                      ${pnlSummary?.trading.totalTraded?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "0.00"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Fees</span>
                    <span className="font-medium">
                      ${pnlSummary?.trading.totalFees?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "0.00"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Avg trade size</span>
                    <span className="font-medium">
                      ${pnlSummary?.trading.avgTradeSize?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "0.00"}
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-secondary/30 border border-border/50 p-4">
                <div className="text-xs text-muted-foreground mb-2">PnL (Realized)</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Realized from trades</span>
                    <span
                      className={`font-medium ${pnlSummary?.pnl.realizedFromTrades >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {pnlSummary?.pnl.realizedFromTrades >= 0 ? "+" : "-"}$
                      {Math.abs(pnlSummary?.pnl.realizedFromTrades ?? 0).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">Resolution payouts</span>
                    <span className="font-medium">
                      ${pnlSummary?.pnl.resolutionPayouts?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? "0.00"}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 pt-1 border-t border-border/30">
                    <span className="text-muted-foreground">Total realized</span>
                    <span
                      className={`font-medium ${pnlSummary?.pnl.totalRealized >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {pnlSummary?.pnl.totalRealized >= 0 ? "+" : "-"}$
                      {Math.abs(pnlSummary?.pnl.totalRealized ?? 0).toLocaleString(undefined, {
                        maximumFractionDigits: 2,
                      })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Trades */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">Trade History</h2>
          {isTradesLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
          ) : tradesErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{tradesErrorMessage}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Market</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead className="text-right">Price</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tradeHistory?.data ?? []).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        {formatDateToLocaleString(t.executedAt, undefined, { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell className="max-w-[220px]">{t.marketTitle}</TableCell>
                      <TableCell>{t.side === "yes" ? "YES" : "NO"}</TableCell>
                      <TableCell className="text-right">{Math.round(t.price * 100)}¢</TableCell>
                      <TableCell className="text-right">{t.quantity}</TableCell>
                      <TableCell className="text-right">
                        ${t.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </TableCell>
                    </TableRow>
                  ))}
                  {tradeHistory?.data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No trades yet
                      </TableCell>
                    </TableRow>
                  ) : null}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between gap-3 mt-3">
                <button
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  disabled={tradesPage <= 1}
                  onClick={() => setTradesPage((p) => Math.max(1, p - 1))}
                >
                  Previous
                </button>
                <div className="text-xs text-muted-foreground">
                  Page {tradeHistory?.page ?? tradesPage} / {tradeHistory?.totalPages ?? 1}
                </div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  disabled={tradesPage >= (tradeHistory?.totalPages ?? 1)}
                  onClick={() => setTradesPage((p) => p + 1)}
                >
                  Next
                </button>
              </div>
            </>
          )}
        </div>

        {/* Balance history (latest txs) */}
        <div className="rounded-xl bg-card border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-3">Balance Transactions</h2>
          {isBalanceLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">Loading...</div>
          ) : balanceErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{balanceErrorMessage}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBalances.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {formatDateToLocaleDateString(tx.createdAt, undefined, { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="max-w-[240px]">{tx.description}</TableCell>
                    <TableCell className="text-right">
                      ${tx.amount.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-right">
                      ${tx.balanceAfter.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
                {recentBalances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      No balance history
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </div>
      </motion.div>
    </AppLayout>
  );
}
