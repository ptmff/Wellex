import { useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Clock, Users, TrendingUp, Droplets, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { formatVolume } from "@/lib/money";
import { AppLayout } from "@/components/layout/AppLayout";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "@/components/TradePanel";
import { useAuth } from "@/auth/AuthContext";
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
  type PriceLinePoint,
} from "@/api/markets";
import { formatDateToLocaleDateString, formatRelativeTime } from "@/lib/date";
import { useI18n } from "@/i18n/I18nContext";
import { formatWx } from "@/lib/money";
import { usePortfolioWebSocket } from "@/hooks/usePortfolioWebSocket";
import { Button } from "@/components/ui/button";

type RangeKey = "1D" | "1W" | "1M" | "All";

function priceLineToChartData(points: PriceLinePoint[], locale: string) {
  return points.map((p) => ({
    time: new Date(p.time * 1000).toLocaleDateString(locale, { month: "short", day: "numeric" }),
    yes: Math.round(p.yesPrice * 100),
    no: Math.round(p.noPrice * 100),
  }));
}

export default function MarketDetail() {
  const { id } = useParams();
  const marketId = id ?? "";
  const { request, user } = useAuth();
  const { language, locale } = useI18n();
  const [range, setRange] = useState<RangeKey>("1M");
  const [commentBody, setCommentBody] = useState("");
  const queryClient = useQueryClient();
  usePortfolioWebSocket({ enabled: !!marketId, marketIds: marketId ? [marketId] : [] });

  const marketQuery = useQuery({
    queryKey: ["market", marketId],
    queryFn: () => getMarket(request, marketId),
    enabled: !!marketId,
  });

  const statsQuery = useQuery({
    queryKey: ["market-stats", marketId],
    queryFn: () => getMarketStats(request, marketId),
    enabled: !!marketId,
  });

  const chartQuery = useQuery({
    queryKey: ["market-price-line", marketId, range],
    queryFn: async () => {
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

      const points = await getMarketPriceLine(request, marketId, {
        from,
        to,
        points: 200,
      });
      return priceLineToChartData(points, locale);
    },
    enabled: !!marketId,
    keepPreviousData: true,
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

  const market: BackendMarket | undefined = marketQuery.data;
  const stats: MarketStats | undefined = statsQuery.data;

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
        typeof (err as any)?.message === "string"
          ? (err as any).message
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

  if (marketQuery.isError) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-destructive">
          {language === "ru" ? "Не удалось загрузить рынок. Проверьте сеть и попробуйте снова." : "Failed to load the market. Check your connection and try again."}
        </div>
      </AppLayout>
    );
  }

  if (!marketQuery.data) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-muted-foreground">{language === "ru" ? "Рынок не найден" : "Market not found"}</div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        {/* Back */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> {language === "ru" ? "Назад к рынкам" : "Back to markets"}
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main */}
          <div className="lg:col-span-2 space-y-4">
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

              <h1 className="text-xl sm:text-2xl font-bold mb-3">{market.title}</h1>

              <div className="flex items-center gap-6 flex-wrap">
                <div>
                  <span className={`text-3xl font-bold ${probColor}`}>{probabilityPct}%</span>
                  <span className="text-xs text-muted-foreground ml-1.5">{language === "ru" ? "шанс" : "chance"}</span>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
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
                  className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
            </div>

            {/* Chart */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">{language === "ru" ? "История цены" : "Price History"}</h2>
                <div className="flex gap-1">
                  {(["1D", "1W", "1M", "All"] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setRange(t)}
                      className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors ${
                        t === range ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t === "All" && language === "ru" ? "Все" : t}
                    </button>
                  ))}
                </div>
              </div>
              {chartQuery.isLoading ? (
                  <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm">
                    {language === "ru" ? "Загрузка графика..." : "Loading chart..."}
                  </div>
              ) : (
                <PriceChart data={chartQuery.data ?? []} />
              )}
            </div>

            {/* Activity */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Последняя активность" : "Recent Activity"}</h2>
              <div className="space-y-2">
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
                ) : (
                  <div className="text-sm text-muted-foreground py-6 text-center">{language === "ru" ? "Сделок пока нет" : "No trades yet"}</div>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h2 className="text-sm font-semibold mb-3">{language === "ru" ? "Обсуждение" : "Discussion"}</h2>
              {user ? (
                <form
                  className="mb-3 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (commentBody.trim()) commentMutation.mutate(commentBody.trim());
                  }}
                >
                  <input
                    value={commentBody}
                    onChange={(e) => setCommentBody(e.target.value)}
                    maxLength={1000}
                    placeholder={language === "ru" ? "Написать комментарий..." : "Write a comment..."}
                    className="flex-1 bg-secondary rounded-lg px-3 py-2 text-sm outline-none"
                  />
                  <Button type="submit" size="sm" disabled={commentMutation.isPending || !commentBody.trim()}>
                    {language === "ru" ? "Отправить" : "Post"}
                  </Button>
                </form>
              ) : (
                <p className="text-xs text-muted-foreground mb-3">
                  <Link to="/login" className="underline">{language === "ru" ? "Войдите" : "Log in"}</Link>
                  {language === "ru" ? ", чтобы комментировать." : " to comment."}
                </p>
              )}
              <div className="space-y-3">
                {(commentsQuery.data?.data ?? []).map((c) => (
                  <div key={c.id} className="text-sm border-b border-border/30 pb-2 last:border-0">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">@{c.user.username}</span>
                      <span className="text-[10px] text-muted-foreground">{formatRelativeTime(c.createdAt)}</span>
                    </div>
                    <p className="text-muted-foreground mt-0.5 whitespace-pre-wrap">{c.body}</p>
                    {user && (user.id === c.user.id || user.role === "admin" || user.role === "moderator") ? (
                      <button
                        type="button"
                        className="text-[11px] text-danger mt-1"
                        onClick={() =>
                          deleteMarketComment(request, marketId, c.id).then(() =>
                            queryClient.invalidateQueries({ queryKey: ["market-comments", marketId] }),
                          )
                        }
                      >
                        {language === "ru" ? "Удалить" : "Delete"}
                      </button>
                    ) : null}
                  </div>
                ))}
                {(commentsQuery.data?.data ?? []).length === 0 ? (
                  <div className="text-xs text-muted-foreground py-4 text-center">
                    {language === "ru" ? "Комментариев пока нет" : "No comments yet"}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Sidebar - Trade */}
          <div className="space-y-4">
            <TradePanel marketId={marketId} currentYesPrice={currentYesPrice01} />

            {canModerate && nextModerationStatus && (
              <div className="rounded-xl bg-card border border-border/50 p-4">
                <h3 className="text-sm font-semibold mb-3">{language === "ru" ? "Статус рынка" : "Market Status"}</h3>
                <div className="space-y-2.5 text-xs">
                  <div className="flex justify-between">
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
                  { label: language === "ru" ? "Резолюция" : "Resolution", value: market.resolutionCriteria ? market.resolutionCriteria : "Oracle" },
                ].map((item) => (
                  <div key={item.label} className="flex justify-between">
                    <span className="text-muted-foreground">{item.label}</span>
                    <span className="font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </AppLayout>
  );
}
