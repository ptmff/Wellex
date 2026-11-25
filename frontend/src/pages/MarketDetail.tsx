import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useParams, Link, useLocation } from "react-router-dom";
import { ArrowLeft, Clock, Users, TrendingUp, Droplets, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { formatVolume } from "@/lib/money";
import { AppLayout } from "@/components/layout/AppLayout";
import { QueryError } from "@/components/QueryError";
import { TradePanel } from "@/components/TradePanel";
import { useAuth } from "@/auth/useAuth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  addMarketComment,
  deleteMarketComment,
  getMarket,
  getMarketPriceLine,
  getMarketStats,
  listMarketComments,
  updateMarketStatus,
  type BackendMarket,
  type MarketStats,
} from "@/api/markets";
import { formatDateToLocaleDateString, formatRelativeTime, parseDate } from "@/lib/date";
import { useI18n } from "@/i18n/useI18n";
import { formatWx } from "@/lib/money";
import { usePortfolioWebSocket } from "@/hooks/usePortfolioWebSocket";
import { Button } from "@/components/ui/button";

type RangeKey = "1D" | "1W" | "1M" | "All";

const PriceChart = lazy(() => import("@/components/PriceChart"));

export default function MarketDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  return <MarketDetailContent key={`${id}:${user?.id ?? "guest"}`} id={id} />;
}

function MarketDetailContent({ id }: { id?: string }) {
  const marketId = id ?? "";
  const { request, user } = useAuth();
  const { language, locale } = useI18n();
  const location = useLocation();
  const commentLabel = language === "ru" ? "Написать комментарий" : "Write a comment";
  const [range, setRange] = useState<RangeKey>("1M");
  const [commentBody, setCommentBody] = useState("");
  const queryClient = useQueryClient();
  const marketIds = useMemo(() => marketId ? [marketId] : [], [marketId]);
  const live = usePortfolioWebSocket({ enabled: !!marketId, marketIds });

  const marketQuery = useQuery({
    queryKey: ["market", marketId],
    queryFn: () => getMarket(request, marketId),
    enabled: !!marketId,
    refetchInterval: live ? 30_000 : 15_000,
  });

  const statsQuery = useQuery({
    queryKey: ["market-stats", marketId],
    queryFn: () => getMarketStats(request, marketId),
    enabled: !!marketId,
    refetchInterval: live ? 30_000 : 15_000,
  });

  const chartQuery = useQuery({
    queryKey: ["market-price-line", marketId, range],
    queryFn: ({ signal }) => {
      const now = Date.now();
      let from: number | undefined;
      let to: number | undefined;
      const seconds = (ms: number) => Math.floor(ms / 1000);

      if (range === "1D") {
        from = seconds(now - 1 * 24 * 60 * 60 * 1000);
        to = seconds(now);
      } else if (range === "1W") {
        from = seconds(now - 7 * 24 * 60 * 60 * 1000);
        to = seconds(now);
      } else if (range === "1M") {
        from = seconds(now - 30 * 24 * 60 * 60 * 1000);
        to = seconds(now);
      }

      return getMarketPriceLine(request, marketId, {
        from,
        to,
        points: 200,
        signal,
      });
    },
    enabled: !!marketId,
    refetchInterval: live ? false : 30_000,
  });

  const commentsQuery = useQuery({
    queryKey: ["market-comments", marketId],
    queryFn: () => listMarketComments(request, marketId),
    enabled: !!marketId,
  });

  const commentMutation = useMutation({
    mutationFn: (body: string) => addMarketComment(request, marketId, body),
    onSuccess: () => {
      setCommentBody("");
      void queryClient.invalidateQueries({ queryKey: ["market-comments", marketId] });
    },
    onError: (err) => {
      toast.error(typeof (err as { message?: string }).message === "string"
        ? (err as { message: string }).message
        : language === "ru" ? "Не удалось отправить комментарий" : "Failed to post comment");
    },
  });

  const deleteComment = useMutation({
    mutationFn: (commentId: string) => deleteMarketComment(request, marketId, commentId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["market-comments", marketId] }),
    onError: (error) => {
      if (error?.name !== "AbortError") toast.error(language === "ru" ? "Не удалось удалить комментарий." : "Could not delete the comment.");
    },
  });

  const market: BackendMarket | undefined = marketQuery.data;
  const stats: MarketStats | undefined = statsQuery.data;

  const closesAt = parseDate(market?.closesAt)?.getTime();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (closesAt === undefined) return;
    let timer: number;
    const checkDeadline = () => {
      const currentTime = Date.now();
      setNow(currentTime);
      if (currentTime < closesAt) timer = window.setTimeout(checkDeadline, Math.min(closesAt - currentTime, 2_147_483_647));
    };
    checkDeadline();
    return () => window.clearTimeout(timer);
  }, [closesAt]);
  const tradingBlocked = market?.status !== "active" || (closesAt !== undefined && closesAt <= now);
  const tradingMessage = tradingBlocked
    ? market?.status === "paused"
      ? language === "ru" ? "Торговля на этом рынке приостановлена." : "Trading on this market is paused."
      : market?.status === "pending"
        ? language === "ru" ? "Торговля на этом рынке ещё не открыта." : "Trading on this market has not opened yet."
        : language === "ru" ? "Торговля на этом рынке завершена." : "Trading on this market has ended."
    : undefined;

  const currentYesPrice01 = useMemo(() => {
    return stats?.currentYesPrice ?? market?.prices.yes ?? 0.5;
  }, [market?.prices.yes, stats?.currentYesPrice]);

  const probabilityPct = useMemo(() => Math.round(currentYesPrice01 * 100), [currentYesPrice01]);

  const probColor = probabilityPct >= 50 ? "text-success" : "text-danger";
  const canModerate = user?.role === "moderator" || user?.role === "admin";

  const nextModerationStatus = (() => {
    if (!marketQuery.data) return undefined;
    if (marketQuery.data.status === "active") return "paused" as const;
    if (marketQuery.data.status === "paused") return "active" as const;
    if (marketQuery.data.status === "pending") return "active" as const;
    return undefined;
  })();

  const statusMutation = useMutation({
    mutationFn: (status: "active" | "paused" | "cancelled") => updateMarketStatus(request, marketId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["market", marketId] });
      queryClient.invalidateQueries({ queryKey: ["market-stats", marketId] });
    },
    onError: (err) => {
      const message =
        typeof err?.message === "string"
          ? err.message
          : language === "ru"
            ? "Не удалось обновить статус рынка"
            : "Failed to update market status";
      toast.error(message);
    },
  });

  if (marketQuery.isLoading) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-muted-foreground">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
      </AppLayout>
    );
  }

  if (!market) {
    const notFound = !marketQuery.error || (marketQuery.error as { status?: number }).status === 404;
    return (
      <AppLayout>
        <div className="mx-auto max-w-md py-12">
          {notFound ? (
            <p>{language === "ru" ? "Рынок не найден." : "Market not found."}</p>
          ) : (
            <QueryError
              message={language === "ru" ? "Не удалось загрузить рынок." : "Could not load the market."}
              retry={() => void marketQuery.refetch()}
              busy={marketQuery.isFetching}
            />
          )}
          <Link to="/markets" className="mt-4 inline-block text-sm text-primary">{language === "ru" ? "Назад к рынкам" : "Back to markets"}</Link>
        </div>
      </AppLayout>
    );
  }

  const ru = language === "ru";
  const resolved = market.status === "resolved";
  const outcomeLabel = market.outcome === "yes"
    ? ru ? "Исход: ДА (YES)" : "Outcome: YES"
    : market.outcome === "no"
      ? ru ? "Исход: НЕТ (NO)" : "Outcome: NO"
      : market.outcome === "invalid"
        ? ru ? "Рынок признан недействительным" : "Market voided"
        : ru ? "Результат пока недоступен" : "Result unavailable";
  const description = market.description?.trim();
  const criteria = market.resolutionCriteria?.trim();
  const resolutionNote = market.resolutionNote?.trim();
  const resolvedDate = parseDate(market.resolvedAt);

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        {/* Back */}
        <Link
          to="/markets"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> {language === "ru" ? "Назад к рынкам" : "Back to markets"}
        </Link>

          {marketQuery.isError && (
            <div className="mb-4">
              <QueryError
                message={language === "ru" ? "Данные рынка могут быть устаревшими." : "Market data may be out of date."}
                retry={() => void marketQuery.refetch()}
                busy={marketQuery.isFetching}
              />
            </div>
          )}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:gap-6">
          {/* Main */}
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {/* Header */}
            <div className="rounded-xl bg-card border border-border/50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                  {market.category?.name ?? (language === "ru" ? "Без категории" : "Uncategorized")}
                </span>
                {market.isFeatured && (
                  <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" /> {language === "ru" ? "В тренде" : "Trending"}
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl font-bold mb-3 [overflow-wrap:anywhere]">{market.title}</h1>

              <div className="flex items-center gap-6 flex-wrap">
                {!resolved && (
                  <div>
                    <span className={`text-3xl font-bold ${probColor}`}>{probabilityPct}%</span>
                    <span className="text-xs text-muted-foreground ml-1.5">{ru ? "шанс" : "chance"}</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" /> {formatVolume(stats?.volume24h ?? market.stats.volume24h)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Droplets className="h-3.5 w-3.5" /> {formatVolume(stats?.liquidityTotal ?? market.stats.liquidityTotal)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {stats?.uniqueTraders?.toLocaleString() ?? "—"}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />{" "}
                    {formatDateToLocaleDateString(market.closesAt, locale, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </div>

                <button
                  type="button"
                  aria-label={language === "ru" ? "Скопировать ссылку на рынок" : "Copy market link"}
                  className="ml-auto min-h-11 min-w-11 p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(window.location.href);
                      toast.success(language === "ru" ? "Ссылка скопирована" : "Link copied");
                    } catch {
                      toast.error(language === "ru" ? "Не удалось скопировать" : "Could not copy");
                    }
                  }}
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>

              {resolved && (
                <section className="mt-3 space-y-1 rounded-lg bg-secondary/60 p-3" aria-labelledby="market-outcome">
                  <h2 id="market-outcome" className="text-sm font-semibold">{outcomeLabel}</h2>
                  {resolvedDate && (
                    <p className="text-xs text-muted-foreground">
                      {ru ? "Дата определения результата" : "Resolved on"}{" "}
                      <time dateTime={resolvedDate.toISOString()}>{resolvedDate.toLocaleDateString(locale, { dateStyle: "long" })}</time>
                    </p>
                  )}
                  {resolutionNote && <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{resolutionNote}</p>}
                </section>
              )}
            </div>

            <details className="rounded-xl border border-border/50 bg-card">
              <summary className="min-h-11 cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold">
                {ru ? "Описание и правила рынка" : "Market description and rules"}
              </summary>
              <div className="space-y-3 border-t border-border/50 px-4 py-3 text-sm">
                {description && (
                  <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">{description}</p>
                )}
                <div>
                  <h2 className="mb-1 font-medium">{ru ? "Как определяется исход" : "How the outcome is determined"}</h2>
                  <p className="whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]">
                    {criteria || (ru ? "Критерии определения исхода пока не опубликованы." : "Resolution criteria have not been published yet.")}
                  </p>
                </div>
              </div>
            </details>

            <Button asChild className="w-full min-h-11 lg:hidden">
              <a href="#market-trading" onClick={(event) => {
                const target = document.getElementById("market-trading");
                if (!target) return;
                event.preventDefault();
                target.focus({ preventScroll: true });
                target.scrollIntoView({ block: "start" });
              }}>{tradingBlocked ? ru ? "Посмотреть стакан" : "View order book" : ru ? "Перейти к торговле" : "Go to trading"}</a>
            </Button>

            {/* Chart */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{language === "ru" ? "История цены" : "Price History"}</h2>
                <div className="flex gap-1">
                  {(["1D", "1W", "1M", "All"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setRange(t)}
                      aria-pressed={t === range}
                      className={`min-h-10 px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                        t === range ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t === "All" && language === "ru" ? "Все" : t}
                    </button>
                  ))}
                </div>
              </div>
              {chartQuery.isError && (
                <QueryError
                  message={language === "ru" ? "Не удалось обновить график." : "Could not update price history."}
                  retry={() => void chartQuery.refetch()}
                  busy={chartQuery.isFetching}
                />
              )}
              {chartQuery.isLoading ? (
                <p role="status" className="grid h-[240px] place-items-center text-sm text-muted-foreground">
                  {language === "ru" ? "Загрузка графика…" : "Loading chart…"}
                </p>
              ) : chartQuery.data?.length ? (
                <Suspense fallback={<div className="h-[240px] sm:h-[280px]" />}>
                  <PriceChart data={chartQuery.data} intraday={range === "1D"} />
                </Suspense>
              ) : chartQuery.isSuccess ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {language === "ru" ? "За этот период данных пока нет." : "No price history for this period yet."}
                </p>
              ) : null}
            </div>
          </div>

          {/* Sidebar - Trade */}
          <div className="min-w-0 space-y-4 lg:col-start-3 lg:row-span-2 lg:row-start-1">
            <section id="market-trading" tabIndex={-1} aria-label={language === "ru" ? "Торговля" : "Trading"} className="scroll-mt-20 rounded-xl">
              <TradePanel
                marketId={marketId}
                currentYesPrice={currentYesPrice01}
                currentNoPrice={stats?.currentNoPrice ?? market.prices.no}
                blockedReason={tradingMessage}
                closesAt={closesAt}
                live={live}
              />
            </section>

            {canModerate && nextModerationStatus && (
              <div className="rounded-xl bg-card border border-border/50 p-4">
                <h3 className="text-sm font-semibold mb-3">{language === "ru" ? "Статус рынка" : "Market Status"}</h3>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{language === "ru" ? "Текущий" : "Current"}</span>
                    <span className="font-medium">{market.status}</span>
                  </div>
                  <div className="flex gap-2">
                    {market.status === "active" ? (
                      <button
                        className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-secondary hover:bg-secondary/80 transition-colors"
                        onClick={() => statusMutation.mutate("paused")}
                        disabled={statusMutation.isPending}
                      >
                        {language === "ru" ? "Пауза" : "Pause"}
                      </button>
                    ) : null}
                    {market.status === "paused" || market.status === "pending" ? (
                      <button
                        className="flex-1 py-2.5 rounded-lg text-sm font-semibold bg-secondary hover:bg-secondary/80 transition-colors"
                        onClick={() => statusMutation.mutate("active")}
                        disabled={statusMutation.isPending}
                      >
                        {language === "ru" ? "Активировать" : "Activate"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}

            {/* Market Stats */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h3 className="text-sm font-semibold mb-3">{language === "ru" ? "Информация о рынке" : "Market Info"}</h3>
              <div className="space-y-2.5 text-xs">
                {[
                  { label: language === "ru" ? "Объем (24ч)" : "Volume (24h)", value: formatVolume(stats?.volume24h ?? market.stats.volume24h) },
                  { label: language === "ru" ? "Ликвидность" : "Liquidity", value: formatVolume(stats?.liquidityTotal ?? market.stats.liquidityTotal) },
                  { label: language === "ru" ? "Трейдеры" : "Traders", value: stats?.uniqueTraders?.toLocaleString() ?? "—" },
                  {
                    label: language === "ru" ? "Дата окончания" : "End Date",
                    value: formatDateToLocaleDateString(market.closesAt, locale, {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    }),
                  },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between gap-3">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="min-w-0 text-right font-medium [overflow-wrap:anywhere]">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="min-w-0 space-y-4 lg:col-start-1 lg:col-span-2 lg:row-start-2">
            {/* Activity */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Последняя активность" : "Recent Activity"}</h2>
              <div className="space-y-2">
                {statsQuery.isError && (
                  <QueryError
                    message={language === "ru" ? "Не удалось обновить сделки." : "Could not update recent trades."}
                    retry={() => void statsQuery.refetch()}
                    busy={statsQuery.isFetching}
                  />
                )}
                {statsQuery.isLoading ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">{language === "ru" ? "Загрузка..." : "Loading..."}</div>
                ) : stats?.recentTrades?.length ? (
                  stats.recentTrades.map((trade, i) => {
                    const side = String(trade.side).toLowerCase() === "yes" ? "YES" : "NO";
                    const priceCents = Math.round(trade.price * 100);
                    const amountWx = formatWx(trade.totalValue);
                    return (
                      <motion.div
                        key={trade.id ?? i}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.05 }}
                        className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
                      >
                        <div className="flex items-center gap-3">
                          <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-muted-foreground">
                            {side.slice(0, 2)}
                          </div>
                          <div>
                            <div className="flex items-center gap-1.5 text-xs">
                              <span className="text-muted-foreground">{language === "ru" ? "куплено" : "bought"}</span>
                              <span className={side === "YES" ? "text-success font-medium" : "text-danger font-medium"}>
                                {side}
                              </span>
                              <span className="text-muted-foreground">{language === "ru" ? "по" : "at"} {priceCents}¢</span>
                            </div>
                            <div className="text-[10px] text-muted-foreground mt-0.5">
                              {formatRelativeTime(trade.executedAt)}
                            </div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs font-medium">{amountWx}</div>
                        </div>
                      </motion.div>
                    );
                  })
                ) : statsQuery.isSuccess ? (
                  <div className="text-sm text-muted-foreground py-6 text-center">{language === "ru" ? "Сделок пока нет" : "No trades yet"}</div>
                ) : null}
              </div>
            </div>

            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Обсуждение" : "Discussion"}</h2>
              {user ? (
                <form
                  className="mb-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (commentBody.trim() && !commentMutation.isPending) commentMutation.mutate(commentBody.trim());
                  }}
                >
                  <input
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    maxLength={1000}
                    aria-label={commentLabel}
                    placeholder={commentLabel}
                    className="min-w-0 flex-1 rounded-lg bg-secondary px-3 py-2 text-base focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                  />
                  <Button type="submit" size="sm" className="min-h-11" disabled={commentMutation.isPending || !commentBody.trim()}>
                    {language === "ru" ? "Отправить" : "Post"}
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted-foreground mb-3">
                  <Link to="/login" state={{ from: location.pathname + location.search }} className="underline">{language === "ru" ? "Войдите" : "Log in"}</Link>
                  {language === "ru" ? ", чтобы комментировать." : " to comment."}
                </p>
              )}
              <div className="space-y-3">
                {commentsQuery.isError && (
                  <QueryError
                    message={language === "ru" ? "Не удалось обновить комментарии." : "Could not update comments."}
                    retry={() => void commentsQuery.refetch()}
                    busy={commentsQuery.isFetching}
                  />
                )}
                {commentsQuery.isLoading && (
                  <p role="status" className="text-sm text-muted-foreground">{language === "ru" ? "Загружаем комментарии…" : "Loading comments…"}</p>
                )}
                {(commentsQuery.data?.data ?? []).map((c) => (
                  <div key={c.id} className="text-sm border-b border-border/30 pb-2 last:border-0">
                    <div className="flex justify-between gap-2">
                      <span className="min-w-0 font-medium [overflow-wrap:anywhere]">@{c.user.username}</span>
                      <span className="text-[10px] text-muted-foreground">{formatRelativeTime(c.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap [overflow-wrap:anywhere]">{c.body}</p>
                    {user && (user.id === c.user.id || user.role === "admin" || user.role === "moderator") ? (
                      <button
                        type="button"
                        className="mt-1 min-h-10 text-xs text-danger disabled:opacity-50"
                        disabled={deleteComment.isPending}
                        onClick={() => deleteComment.mutate(c.id)}
                      >
                        {language === "ru" ? "Удалить" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                ))}
                {commentsQuery.isSuccess && commentsQuery.data.data.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    {language === "ru" ? "Комментариев пока нет" : "No comments yet"}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

        </div>
      </motion.div>
    </AppLayout>
  );
}
