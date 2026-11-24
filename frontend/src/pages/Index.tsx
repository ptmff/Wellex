import { useEffect, useState } from "react";
import { TrendingUp, Clock, Sparkles, LayoutGrid, List } from "lucide-react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { listMarketCategories, listMarkets, type BackendMarket, type ListMarketsInput } from "@/api/markets";
import { useAuth } from "@/auth/useAuth";
import { MarketCard } from "@/components/MarketCard";
import { QueryError } from "@/components/QueryError";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/i18n/useI18n";
import { parseDate } from "@/lib/date";
import { formatWx } from "@/lib/money";

type Filter = "all" | "trending" | "new" | "ending";
const DAY_MS = 86_400_000;

function matchesWindow(market: BackendMarket, filter: Filter, now: number) {
  if (filter === "new") {
    const created = parseDate(market.createdAt)?.getTime();
    return created !== undefined && created <= now && now - created <= 14 * DAY_MS;
  }
  if (filter === "ending") {
    const closes = parseDate(market.closesAt)?.getTime();
    return closes !== undefined && closes >= now && closes - now <= 7 * DAY_MS;
  }
  return true;
}

export default function MarketsPage() {
  const { t, language } = useI18n();
  const { request } = useAuth();
  const ru = language === "ru";
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryId, setCategoryId] = useState<string>();
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [params, setParams] = useSearchParams();
  const search = params.get("q") ?? "";
  const [term, setTerm] = useState(search.trim());
  useEffect(() => {
    const timer = window.setTimeout(() => setTerm(search.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const filters = [
    { key: "all", icon: Sparkles },
    { key: "trending", icon: TrendingUp },
    { key: "new", icon: Sparkles },
    { key: "ending", icon: Clock },
  ] as const;

  const categories = useQuery({
    queryKey: ["market-categories"],
    queryFn: () => listMarketCategories(request),
    staleTime: 60_000,
  });
  const listParams: ListMarketsInput = {
    limit: filter === "new" || filter === "ending" ? 30 : 12,
    search: term || undefined,
    categoryId,
    featured: filter === "trending" ? true : undefined,
    status: filter === "ending" ? "active" : undefined,
    sortBy: filter === "ending" ? "closes_at" : "created_at",
    sortOrder: filter === "ending" ? "asc" : "desc",
  };
  const markets = useInfiniteQuery({
    queryKey: ["markets", listParams],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => listMarkets(request, { ...listParams, page: pageParam }, signal),
    getNextPageParam: ({ page, data, totalPages }) => {
      if (page >= totalPages) return undefined;
      const tail = data[data.length - 1];
      const now = Date.now();
      if (filter === "ending" && (parseDate(tail?.closesAt)?.getTime() ?? -Infinity) > now + 7 * DAY_MS) return undefined;
      if (filter === "new" && (parseDate(tail?.createdAt)?.getTime() ?? Infinity) < now - 14 * DAY_MS) return undefined;
      return page + 1;
    },
    staleTime: 30_000,
  });

  const now = Date.now();
  const visible = new Map<string, BackendMarket>();
  for (const page of markets.data?.pages ?? []) {
    for (const market of page.data) if (matchesWindow(market, filter, now)) visible.set(market.id, market);
  }
  const rows = [...visible.values()];
  const { hasNextPage, isFetching, isError, fetchNextPage } = markets;
  const matching = search.trim() === term;
  const scanning = matching && filter === "ending" && !rows.length && hasNextPage && !isError;
  useEffect(() => {
    if (scanning && !isFetching) void fetchNextPage();
  }, [fetchNextPage, isFetching, scanning]);

  const volume = rows.reduce((sum, market) => sum + (market.stats.volume24h ?? 0), 0);
  const total = markets.data?.pages[0]?.total;

  return (
    <AppLayout>
      <div className="mb-5">
        <h1 className="mb-1 text-2xl font-bold sm:text-3xl">{t("index.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("index.subtitle")}</p>
      </div>
      <div className="mb-3 flex items-center gap-2">
        <input
          type="search"
          value={search}
          onChange={(event) => setParams(event.target.value ? { q: event.target.value } : {}, { replace: true })}
          aria-label={t("index.search")}
          placeholder={t("index.search")}
          className="min-h-11 min-w-0 flex-1 rounded-lg bg-secondary px-3 text-base focus-visible:ring-2 focus-visible:ring-ring sm:max-w-sm"
        />
        {([
          { key: "grid", icon: LayoutGrid, label: ru ? "Плитка" : "Grid" },
          { key: "list", icon: List, label: ru ? "Список" : "List" },
        ] as const).map(({ key, icon: Icon, label }) => (
          <Button key={key} variant={viewMode === key ? "secondary" : "ghost"} size="icon" className="min-h-11 min-w-11"
            aria-pressed={viewMode === key} aria-label={label} onClick={() => setViewMode(key)}>
            <Icon aria-hidden="true" />
          </Button>
        ))}
      </div>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {filters.map(({ key, icon: Icon }) => (
          <Button key={key} variant={filter === key ? "default" : "secondary"} size="sm" className="min-h-10"
            aria-pressed={filter === key} onClick={() => setFilter(key)}>
            <Icon aria-hidden="true" /> {t(`index.filter.${key}`)}
          </Button>
        ))}
      </div>
      <div className="mb-3 flex gap-1 overflow-x-auto py-1" role="group" aria-label={ru ? "Категории" : "Categories"}>
        <Button variant={!categoryId ? "secondary" : "ghost"} size="sm" className="min-h-10 shrink-0"
          aria-pressed={!categoryId} onClick={() => setCategoryId(undefined)}>{t("index.filter.all")}</Button>
        {categories.data?.map((category) => (
          <Button key={category.id} variant={categoryId === category.id ? "secondary" : "ghost"} size="sm"
            className="min-h-10 shrink-0" aria-pressed={categoryId === category.id} onClick={() => setCategoryId(category.id)}>
            {category.name}
          </Button>
        ))}
      </div>
      {categories.isError && (
        <QueryError message={ru ? "Не удалось обновить категории." : "Could not update categories."}
          retry={() => void categories.refetch()} busy={categories.isFetching} />
      )}
      {matching && markets.data && rows.length > 0 && (
        <p className="mb-4 text-xs text-muted-foreground">
          {ru ? "Показано" : "Showing"} {rows.length}{filter === "new" || filter === "ending" || total === undefined ? "" : ` / ${total}`}
          {" · "}
          {ru ? "Объём за 24 ч по показанным рынкам" : "24h volume for displayed markets"}{" "}{formatWx(volume, { compact: true })}
        </p>
      )}
      {matching && markets.isError && (
        <QueryError message={t("index.failedToLoad", "Не удалось загрузить рынки.")}
          retry={() => void (markets.isFetchNextPageError ? markets.fetchNextPage() : markets.refetch())} busy={markets.isFetching} />
      )}
      {!matching || markets.isPending || scanning ? (
        <p role="status" className="py-12 text-center text-sm text-muted-foreground">{t("index.loading")}</p>
      ) : rows.length ? (
        <div className={viewMode === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3" : "grid gap-2"}>
          {rows.map((market) => <MarketCard key={market.id} market={market} />)}
        </div>
      ) : !markets.isError ? (
        <p className="py-12 text-center text-sm text-muted-foreground">{t("index.noMarkets")}</p>
      ) : null}
      {matching && rows.length > 0 && hasNextPage && !markets.isFetchNextPageError && (
        <div className="mt-5 flex justify-center">
          <Button variant="secondary" className="min-h-11" onClick={() => void fetchNextPage()} disabled={isFetching}>
            {markets.isFetchingNextPage ? t("index.loading") : t("index.loadMore")}
          </Button>
        </div>
      )}
    </AppLayout>
  );
}
