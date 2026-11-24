import { accountKey, invalidatePortfolio } from "@/auth/accountQueries";
import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { ArrowUpRight, ArrowDownRight } from "lucide-react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { QueryError } from "@/components/QueryError";
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
import { useAuth } from "@/auth/useAuth";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePortfolioWebSocket } from "@/hooks/usePortfolioWebSocket";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type {
  PaginatedResult,
  PortfolioBalanceTx,
  PortfolioPnlEndpointResponse,
  PortfolioPosition,
  PortfolioSummaryResponse,
  PortfolioTrade,
} from "@/lib/portfolio";
import { formatDateToLocaleDateString, formatDateToLocaleString, parseDate } from "@/lib/date";
import { executeMarketTrade, getTradeQuote, type MarketTradeInput } from "@/api/trading";
import { useI18n } from "@/i18n/useI18n";
import { formatWx } from "@/lib/money";
import { Link } from "react-router-dom";

type ChartPoint = {
  time: string;
  value: number;
};

export default function Portfolio() {
  const queryClient = useQueryClient();
  const { request, user } = useAuth();
  const { language, locale } = useI18n();

  const [tradesPage, setTradesPage] = useState(1);
  const tradesLimit = 10;

  const [balanceHistoryPage] = useState(1);
  const balanceHistoryLimit = 50;
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null);
  const [maxSlippage, setMaxSlippage] = useState(5);

  const {
    data: portfolio,
    isLoading: isPortfolioLoading,
    isError: isPortfolioError,
    error: portfolioError,
  } = useQuery({
    queryKey: accountKey(user?.id, "portfolio"),
    queryFn: () => request<PortfolioSummaryResponse>("/portfolio", { method: "GET" }),
    refetchInterval: 30_000,
  });

  const {
    data: apiPositions,
    isLoading: isPositionsLoading,
    isError: isPositionsError,
    error: positionsError,
  } = useQuery({
    queryKey: accountKey(user?.id, "portfolio-positions"),
    queryFn: () => request<PortfolioPosition[]>("/portfolio/positions", { method: "GET" }),
    refetchInterval: 30_000,
  });

  const marketIds = useMemo(() => (apiPositions ?? []).map((p) => p.marketId), [apiPositions]);
  const live = usePortfolioWebSocket({ enabled: !!user, marketIds });

  const {
    data: pnlSummary,
    isLoading: isPnlLoading,
    isError: isPnlError,
    error: pnlError,
  } = useQuery({
    queryKey: accountKey(user?.id, "portfolio-pnl"),
    queryFn: () => request<PortfolioPnlEndpointResponse>("/portfolio/pnl", { method: "GET" }),
    refetchInterval: live ? 60_000 : 20_000,
  });

  const {
    data: balanceHistory,
    isLoading: isBalanceLoading,
    isError: isBalanceError,
    error: balanceError,
  } = useQuery({
    queryKey: accountKey(user?.id, "portfolio-balance-history", balanceHistoryPage, balanceHistoryLimit),
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
    queryKey: accountKey(user?.id, "portfolio-trades", tradesPage, tradesLimit),
    queryFn: () =>
      request<PaginatedResult<PortfolioTrade>>(`/portfolio/trades?page=${tradesPage}&limit=${tradesLimit}`, {
        method: "GET",
      }),
    placeholderData: keepPreviousData,
  });

  const portfolioErrorMessage = isPortfolioError
    ? typeof portfolioError?.message === "string"
      ? portfolioError?.message
      : language === "ru"
        ? "Не удалось загрузить портфель"
        : "Failed to load portfolio"
    : null;

  const positionsErrorMessage = isPositionsError
    ? typeof positionsError?.message === "string"
      ? positionsError?.message
      : language === "ru"
        ? "Не удалось загрузить позиции"
        : "Failed to load positions"
    : null;

  const pnlErrorMessage = isPnlError
    ? typeof pnlError?.message === "string"
      ? pnlError?.message
      : language === "ru"
        ? "Не удалось загрузить PnL"
        : "Failed to load PnL"
    : null;

  const balanceErrorMessage = isBalanceError
    ? typeof balanceError?.message === "string"
      ? balanceError?.message
      : language === "ru"
        ? "Не удалось загрузить историю баланса"
        : "Failed to load balance history"
    : null;

  const tradesErrorMessage = isTradesError
    ? typeof tradesError?.message === "string"
      ? tradesError?.message
      : language === "ru"
        ? "Не удалось загрузить сделки"
        : "Failed to load trades"
    : null;

  const totalBalance = portfolio?.balance.total ?? 0;
  const availableBalance = portfolio?.balance.available ?? 0;
  const reservedBalance = portfolio?.balance.reserved ?? 0;
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
  const closingPosition = (apiPositions ?? []).find((p) => p.id === closingPositionId) ?? null;

  const marketCloseQuoteQuery = useQuery({
    queryKey: accountKey(user?.id, "market-close-quote",
      closingPosition?.marketId,
      closingPosition?.side,
      closingPosition?.quantity,
    ),
    queryFn: () =>
      getTradeQuote(request, closingPosition!.marketId, {
        side: closingPosition!.side,
        action: "sell",
        amount: closingPosition!.quantity,
      }),
    enabled: !!closingPosition && !!request && !!user,
    refetchInterval: closingPosition ? 5000 : false,
  });

  const marketCloseMutation = useMutation({
    mutationFn: ({ marketId, ...input }: MarketTradeInput & { marketId: string }) =>
      executeMarketTrade(request, marketId, input),
    onSuccess: async (result, input) => {
      const remaining = Math.max(0, input.amount - result.sharesTransacted);
      const filled = result.sharesTransacted.toLocaleString(locale, { maximumFractionDigits: 8 });
      const leftover = remaining.toLocaleString(locale, { maximumFractionDigits: 8 });
      toast.success(remaining > 0.0000001
        ? language === "ru" ? `Частичное исполнение: продано ${filled}, осталось ${leftover} акций.`
          : `Partial fill: sold ${filled} shares, ${leftover} remain.`
        : language === "ru" ? `Позиция закрыта. Продано ${filled} акций.` : `Position closed. Sold ${filled} shares.`);
      setClosingPositionId(null);
      await invalidatePortfolio(queryClient, user?.id);
    },
    onError: (error) => {
      if (error?.name !== "AbortError") toast.error(error?.message || (language === "ru" ? "Не удалось закрыть позицию" : "Failed to close position"));
    },
  });
  const quote = marketCloseQuoteQuery.data;
  const partialQuote = !!(quote && closingPosition && closingPosition.quantity - quote.shares > 0.0000001);

  const chartData: ChartPoint[] = useMemo(() => {
    const txs = balanceHistory?.data ?? [];

    return txs
      .map((tx, idx) => {
        const d = parseDate(tx.createdAt);
        return {
          time: d ? d.toLocaleDateString(locale, { month: "short", day: "numeric" }) : language === "ru" ? "Н/Д" : "TBD",
          value: tx.balanceAfter,
          ts: d ? d.getTime() : idx, // fallback keeps chart usable even if date parsing fails
        };
      })
      .sort((a, b) => a.ts - b.ts)
      .map(({ time, value }) => ({ time, value }));
  }, [balanceHistory, language, locale]);

  const recentBalances = useMemo(() => (balanceHistory?.data ?? []).slice(0, 10), [balanceHistory]);

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="text-lg font-bold [overflow-wrap:anywhere] sm:text-2xl mb-6">{language === "ru" ? "Портфель" : "Portfolio"}</h1>
        {user && portfolio && availableBalance <= 0 ? (
          <div className="rounded-xl border border-border/50 bg-card p-4 mb-4 text-sm">
            {language === "ru" ? "Баланс пуст. " : "Balance is empty. "}
            <Link to="/shop" className="text-primary hover:underline">
              {language === "ru" ? "Купить WX или посмотреть рекламу" : "Buy WX or watch an ad"}
            </Link>
          </div>
        ) : null}

        {/* Balance cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Доступный баланс" : "Available Balance"}</div>
            <div className="text-lg font-bold [overflow-wrap:anywhere] sm:text-2xl">{isPortfolioLoading ? "…" : !portfolio ? "—" : formatWx(availableBalance)}</div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Зарезервированный баланс" : "Reserved Balance"}</div>
            <div className="text-lg font-bold [overflow-wrap:anywhere] sm:text-2xl">{isPortfolioLoading ? "…" : !portfolio ? "—" : formatWx(reservedBalance)}</div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Общий баланс" : "Total Balance"}</div>
            <div className="text-lg font-bold [overflow-wrap:anywhere] sm:text-2xl">{isPortfolioLoading ? "…" : !portfolio ? "—" : formatWx(totalBalance)}</div>
          </div>
          <div className="rounded-xl bg-card border border-border/50 p-4">
            <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Общий P&L" : "Total P&L"}</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`text-lg font-bold [overflow-wrap:anywhere] sm:text-2xl ${isPnlPositive ? "text-success" : "text-danger"}`}>
                {isPortfolioLoading ? "…" : !portfolio ? "—" : formatWx(totalPnl, { signed: true })}
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
                {isPortfolioLoading || !portfolio ? "—" : `${pnlPercent.toFixed(2)}%`}
              </span>
            </div>
          </div>
        </div>

        {/* Open positions */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <div className="text-xs text-muted-foreground mb-1">{language === "ru" ? "Открытые позиции" : "Open Positions"}</div>
          <div className="text-lg font-bold [overflow-wrap:anywhere] sm:text-2xl">{isPortfolioLoading ? "…" : portfolio?.positions.open ?? "—"}</div>
        </div>

        {/* Performance chart */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Динамика" : "Performance"}</h2>
          {isBalanceLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
          ) : balanceErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{balanceErrorMessage}</div>
          ) : chartData.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Нет данных" : "No data"}</div>
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
                  tickFormatter={(v) => formatWx(v, { compact: true, digits: 1 })}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(225, 15%, 11%)",
                    border: "1px solid hsl(225, 12%, 16%)",
                    borderRadius: "8px",
                    fontSize: "12px",
                  }}
                  labelStyle={{ color: "hsl(215, 12%, 50%)" }}
                  formatter={(v: number) => [formatWx(v, { digits: 0 }), language === "ru" ? "Значение" : "Value"]}
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
          <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Открытые позиции" : "Open Positions"}</h2>
          <div className="space-y-2">
            {isPortfolioLoading || isPositionsLoading ? (
              <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
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
                        {pos.shares} {language === "ru" ? "акций" : "shares"} @ {Math.round(pos.avgPrice01 * 100)}¢
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
                      {formatWx(Math.abs(pos.pnl))}
                    </div>
                    <div className={`text-[11px] ${pos.pnl >= 0 ? "text-success" : "text-danger"}`}>
                      {pos.pnlPercent > 0 ? "+" : ""}
                      {pos.pnlPercent}%
                    </div>
                    <button
                      className="text-[11px] mt-1 text-muted-foreground hover:text-foreground"
                      onClick={() => setClosingPositionId(pos.id)}
                    >
                      {language === "ru" ? "Закрыть по рынку" : "Close at market"}
                    </button>
                  </div>
                </motion.div>
              ))
            )}
          </div>
        </div>

        {/* PnL summary */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mt-6 mb-6">
          <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Сводка PnL" : "PnL Summary"}</h2>
          {isPnlLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
          ) : pnlErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{pnlErrorMessage}</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="rounded-xl bg-secondary/30 border border-border/50 p-4">
                <div className="text-xs text-muted-foreground mb-2">{language === "ru" ? "Торговля" : "Trading"}</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Сделки" : "Trades"}</span>
                    <span className="font-medium">{pnlSummary?.trading.tradeCount ?? 0}</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Проторговано" : "Total traded"}</span>
                    <span className="font-medium">
                      {formatWx(pnlSummary?.trading.totalTraded ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Комиссии" : "Fees"}</span>
                    <span className="font-medium">
                      {formatWx(pnlSummary?.trading.totalFees ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Средний размер сделки" : "Avg trade size"}</span>
                    <span className="font-medium">
                      {formatWx(pnlSummary?.trading.avgTradeSize ?? 0)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="rounded-xl bg-secondary/30 border border-border/50 p-4">
                <div className="text-xs text-muted-foreground mb-2">{language === "ru" ? "PnL (реализованный)" : "PnL (Realized)"}</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Реализовано со сделок" : "Realized from trades"}</span>
                    <span
                      className={`font-medium ${(pnlSummary?.pnl.realizedFromTrades ?? 0) >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {formatWx(pnlSummary?.pnl.realizedFromTrades ?? 0, { signed: true })}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Выплаты по резолюции" : "Resolution payouts"}</span>
                    <span className="font-medium">
                      {formatWx(pnlSummary?.pnl.resolutionPayouts ?? 0)}
                    </span>
                  </div>
                  <div className="flex justify-between gap-3 pt-1 border-t border-border/30">
                    <span className="text-muted-foreground">{language === "ru" ? "Итого реализовано" : "Total realized"}</span>
                    <span
                      className={`font-medium ${(pnlSummary?.pnl.totalRealized ?? 0) >= 0 ? "text-success" : "text-danger"}`}
                    >
                      {formatWx(pnlSummary?.pnl.totalRealized ?? 0, { signed: true })}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Trades */}
        <div className="rounded-xl bg-card border border-border/50 p-4 mb-6">
          <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "История сделок" : "Trade History"}</h2>
          {isTradesLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
          ) : tradesErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{tradesErrorMessage}</div>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{language === "ru" ? "Дата" : "Date"}</TableHead>
                    <TableHead>{language === "ru" ? "Рынок" : "Market"}</TableHead>
                    <TableHead>{language === "ru" ? "Сторона" : "Side"}</TableHead>
                    <TableHead className="text-right">{language === "ru" ? "Цена" : "Price"}</TableHead>
                    <TableHead className="text-right">{language === "ru" ? "Кол-во" : "Qty"}</TableHead>
                    <TableHead className="text-right">{language === "ru" ? "Итого" : "Total"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(tradeHistory?.data ?? []).map((t) => (
                    <TableRow key={t.id}>
                      <TableCell>
                        {formatDateToLocaleString(t.executedAt, locale, { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell className="max-w-[220px]">{t.marketTitle}</TableCell>
                      <TableCell>{t.side === "yes" ? "YES" : "NO"}</TableCell>
                      <TableCell className="text-right">{Math.round(t.price * 100)}¢</TableCell>
                      <TableCell className="text-right">{t.quantity}</TableCell>
                      <TableCell className="text-right">
                        {formatWx(t.totalValue)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {tradeHistory?.data?.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        {language === "ru" ? "Сделок пока нет" : "No trades yet"}
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
                  {language === "ru" ? "Назад" : "Previous"}
                </button>
                <div className="text-xs text-muted-foreground">
                  {language === "ru" ? "Страница" : "Page"} {tradeHistory?.page ?? tradesPage} / {tradeHistory?.totalPages ?? 1}
                </div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                  disabled={tradesPage >= (tradeHistory?.totalPages ?? 1)}
                  onClick={() => setTradesPage((p) => p + 1)}
                >
                  {language === "ru" ? "Далее" : "Next"}
                </button>
              </div>
            </>
          )}
        </div>

        {/* Balance history (latest txs) */}
        <div className="rounded-xl bg-card border border-border/50 p-4">
          <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Транзакции баланса" : "Balance Transactions"}</h2>
          {isBalanceLoading ? (
            <div className="text-sm text-muted-foreground py-4 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
          ) : balanceErrorMessage ? (
            <div className="text-sm text-destructive py-4 text-center">{balanceErrorMessage}</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{language === "ru" ? "Дата" : "Date"}</TableHead>
                  <TableHead>{language === "ru" ? "Описание" : "Description"}</TableHead>
                  <TableHead className="text-right">{language === "ru" ? "Сумма" : "Amount"}</TableHead>
                  <TableHead className="text-right">{language === "ru" ? "Баланс" : "Balance"}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentBalances.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell>
                      {formatDateToLocaleDateString(tx.createdAt, locale, { dateStyle: "medium" })}
                    </TableCell>
                    <TableCell className="max-w-[240px]">{tx.description}</TableCell>
                    <TableCell className="text-right">
                      {formatWx(tx.amount)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatWx(tx.balanceAfter)}
                    </TableCell>
                  </TableRow>
                ))}
                {recentBalances.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                      {language === "ru" ? "Истории баланса нет" : "No balance history"}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
        </div>
      </motion.div>

      <Dialog open={!!closingPosition} onOpenChange={(open) => !open && setClosingPositionId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{language === "ru" ? "Закрыть позицию по рынку" : "Close Position at Market"}</DialogTitle>
            <DialogDescription>
              {language === "ru"
                ? `Продайте акции ${closingPosition?.side.toUpperCase()} по доступным заявкам. При недостатке ликвидности часть позиции останется открытой.`
                : `Sell ${closingPosition?.side.toUpperCase()} shares into available bids. Some shares may remain open if liquidity is limited.`}
            </DialogDescription>
          </DialogHeader>

          {!closingPosition ? null : (
            <div className="space-y-3 text-sm">
              <div className="rounded-md border border-border/60 bg-secondary/30 p-3">
                <div className="font-medium [overflow-wrap:anywhere]">{closingPosition.marketTitle}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {closingPosition.side.toUpperCase()} | {closingPosition.quantity.toFixed(4)} {language === "ru" ? "акций" : "shares"}
                </div>
              </div>

              <div>
                <label htmlFor="close-position-slippage" className="text-xs text-muted-foreground mb-1 block">{language === "ru" ? "Макс. проскальзывание (%)" : "Max slippage (%)"}</label>
                <input
                  id="close-position-slippage"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={50}
                  step={0.1}
                  value={maxSlippage}
                  onChange={(e) => {
                    const n = Number(e.target.value);
                    if (!Number.isFinite(n)) return;
                    setMaxSlippage(Math.max(0, Math.min(50, n)));
                  }}
                  className="w-full bg-secondary rounded-lg px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
                />
              </div>

              <div className="rounded-md border border-border/60 p-3 space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === "ru" ? "Оценочная выручка" : "Estimated proceeds"}</span>
                  <span className="font-medium">
                    {marketCloseQuoteQuery.data ? formatWx(marketCloseQuoteQuery.data.totalCost) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === "ru" ? "Оценочная ср. цена" : "Estimated avg price"}</span>
                  <span className="font-medium">
                    {marketCloseQuoteQuery.data ? `${Math.round(marketCloseQuoteQuery.data.averagePrice * 100)}c` : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === "ru" ? "Комиссии" : "Fees"}</span>
                  <span className="font-medium">
                    {marketCloseQuoteQuery.data ? formatWx(marketCloseQuoteQuery.data.fee) : "—"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{language === "ru" ? "Влияние на цену" : "Price impact"}</span>
                  <span className="font-medium">
                    {marketCloseQuoteQuery.data ? `${marketCloseQuoteQuery.data.priceImpact.toFixed(2)}%` : "—"}
                  </span>
                </div>
                {marketCloseQuoteQuery.isLoading ? (
                  <div className="text-muted-foreground pt-1">{language === "ru" ? "Получаем актуальную котировку..." : "Fetching live quote..."}</div>
                ) : null}
                {marketCloseQuoteQuery.isError && (
                  <QueryError
                    message={language === "ru" ? "Котировка недоступна. Проверьте ликвидность и попробуйте снова." : "Quote unavailable. Check liquidity and try again."}
                    retry={() => void marketCloseQuoteQuery.refetch()}
                    busy={marketCloseQuoteQuery.isFetching}
                  />
                )}
                {partialQuote && !marketCloseQuoteQuery.isError && (
                  <p role="status" className="pt-1 text-warning">
                    {language === "ru"
                      ? `По текущей котировке можно продать ${quote.shares.toLocaleString(locale)} из ${closingPosition.quantity.toLocaleString(locale)} акций.`
                      : `The current quote can sell ${quote.shares.toLocaleString(locale)} of ${closingPosition.quantity.toLocaleString(locale)} shares.`}
                  </p>
                )}
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setClosingPositionId(null)} disabled={marketCloseMutation.isPending}>
              {language === "ru" ? "Отмена" : "Cancel"}
            </Button>
            <Button
              variant="destructive"
              disabled={marketCloseMutation.isPending || !closingPosition || !quote?.shares || marketCloseQuoteQuery.isError}
              onClick={() => {
                if (!closingPosition || !quote || marketCloseMutation.isPending) return;
                marketCloseMutation.mutate({
                  marketId: closingPosition.marketId,
                  side: closingPosition.side,
                  action: "sell",
                  amount: closingPosition.quantity,
                  maxSlippage,
                  expectedPrice: quote.averagePrice,
                });
              }}
            >
              {marketCloseMutation.isPending ? (language === "ru" ? "Закрываем..." : "Closing...") : partialQuote ? language === "ru" ? "Продать доступный объём" : "Sell available shares" : language === "ru" ? "Закрыть позицию" : "Close position now"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppLayout>
  );
}
