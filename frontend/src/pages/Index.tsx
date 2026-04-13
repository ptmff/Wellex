import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Clock, Sparkles, LayoutGrid, List } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { AppLayout } from "@/components/layout/AppLayout";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { listMarkets, type BackendMarket, type ListMarketsInput } from "@/api/markets";
import { parseDate } from "@/lib/date";
import { useI18n } from "@/i18n/I18nContext";

type Filter = "all" | "trending" | "new" | "ending";

export default function MarketsPage() {
  const { t, language } = useI18n();
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryKey, setCategoryKey] = useState<string | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filters: { key: Filter; label: string; icon: any }[] = [
    { key: "all", label: t("index.filter.all"), icon: Sparkles },
    { key: "trending", label: t("index.filter.trending"), icon: TrendingUp },
    { key: "new", label: t("index.filter.new"), icon: Sparkles },
    { key: "ending", label: t("index.filter.ending"), icon: Clock },
  ];

  const { request } = useAuth();

  const listLimit = filter === "new" || filter === "ending" ? 30 : 12;

  // Формируем categories из текущей страницы рынков.
  const [categories, setCategories] = useState<Array<{ key: string; name: string; id?: string }>>([{ key: "all", name: t("index.filter.all") }]);

  const listParams = useMemo<ListMarketsInput>(() => {
    return {
      page,
      limit: listLimit,
      search: search.trim() ? search.trim() : undefined,
      // В текущем ответе бекенда нет `category.id`, поэтому фильтрацию по категориям временно отключаем
      // и используем категории только для отображения/UX.
      categoryId: undefined,
      featured: filter === "trending" ? true : undefined,
      sortBy: "created_at",
      sortOrder: "desc",
    };
  }, [filter, listLimit, page, search]);

  const marketsQuery = useQuery({
    queryKey: ["markets", listParams],
    queryFn: () => listMarkets(request, listParams),
    enabled: !!request,
    keepPreviousData: true,
    placeholderData: undefined,
  });

  // Сброс статуса при смене основных фильтров/поиска.
  useEffect(() => {
    setPage(1);
  }, [filter, search]);

  // Обновляем список категорий из текущих данных рынка.
  useEffect(() => {
    const items: BackendMarket[] = marketsQuery.data?.data ?? [];
    const map = new Map<string, { key: string; name: string; id?: string }>();
    for (const m of items) {
      const cat = m.category;
      if (!cat) continue;
      const key = cat.slug ?? cat.name;
      if (!map.has(key)) map.set(key, { key, name: cat.name, id: cat.id });
    }
    const arr = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
    setCategories([{ key: "all", name: t("index.filter.all") }, ...arr]);
  }, [marketsQuery.data, t]);

  const filtered = useMemo(() => {
    const data = marketsQuery.data?.data ?? [];
    const categoryFiltered =
      categoryKey === "all"
        ? data
        : data.filter((m) => (m.category?.slug ?? m.category?.name ?? "") === categoryKey);
    if (filter === "new") {
      const now = Date.now();
      const windowMs = 14 * 24 * 60 * 60 * 1000;
      return categoryFiltered.filter((m) => {
        const t = parseDate(m.createdAt)?.getTime();
        return t !== null && now - t <= windowMs;
      });
    }
    if (filter === "ending") {
      const now = Date.now();
      const windowMs = 7 * 24 * 60 * 60 * 1000;
      return data
        .filter((m) => {
          const closesTs = parseDate(m.closesAt)?.getTime();
          return closesTs !== null && closesTs >= now && closesTs - now <= windowMs;
        })
        .sort((a, b) => (parseDate(a.closesAt)?.getTime() ?? 0) - (parseDate(b.closesAt)?.getTime() ?? 0));
    }
    // `trending` is already applied via backend `featured=true`.
    return categoryFiltered;
  }, [filter, marketsQuery.data, categoryKey]);

  return (
    <AppLayout>
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">
          {t("index.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("index.subtitle")}
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: t("nav.markets"), value: "248" },
          { label: language === "ru" ? "Объем 24ч" : "24h Volume", value: "$12.4M" },
          { label: language === "ru" ? "Трейдеры" : "Traders", value: "18.2K" },
        ].map((stat) => (
          <div key={stat.label} className="rounded-xl bg-card border border-border/50 p-3 text-center">
            <div className="text-lg font-bold text-foreground">{stat.value}</div>
            <div className="text-[11px] text-muted-foreground">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-2 scrollbar-none">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => {
              setPage(1);
              setFilter(f.key);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all duration-200 ${
              filter === f.key
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground"
            }`}
          >
            <f.icon className="h-3 w-3" />
            {f.label}
          </button>
        ))}

        <div className="ml-auto flex gap-1 shrink-0 items-center">
          <input
            value={search}
            onChange={(e) => {
              setPage(1);
              setSearch(e.target.value);
            }}
            placeholder={t("index.search")}
            className="w-40 hidden sm:block bg-secondary text-xs text-foreground placeholder:text-muted-foreground rounded-lg px-3 py-1.5 outline-none focus:ring-1 focus:ring-primary/50 transition-all"
          />
          <button
            onClick={() => setViewMode("grid")}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === "grid" ? "text-foreground bg-accent" : "text-muted-foreground"
            }`}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className={`p-1.5 rounded-md transition-colors ${
              viewMode === "list" ? "text-foreground bg-accent" : "text-muted-foreground"
            }`}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Categories */}
      <div className="flex items-center gap-1.5 mb-6 overflow-x-auto pb-2 scrollbar-none">
        {categories.map((cat) => (
          <button
            key={cat.key}
            onClick={() => {
              setPage(1);
              setCategoryKey(cat.key as any);
            }}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 ${
              categoryKey === cat.key
                ? "bg-accent text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {/* Grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${filter}-${categoryKey}-${search}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"
              : "flex flex-col gap-2"
          }
        >
          {marketsQuery.isLoading || marketsQuery.isFetching ? (
            <div className="col-span-full text-center py-12 text-muted-foreground">{t("index.loading")}</div>
          ) : marketsQuery.error ? (
            <div className="col-span-full text-center py-12 text-destructive">
              {typeof (marketsQuery.error as any)?.message === "string"
                ? (marketsQuery.error as any).message
                : t("index.failedToLoad", "Не удалось загрузить рынки")}
            </div>
          ) : filtered.map((market, i) => (
            <MarketCard key={market.id} market={market as BackendMarket} index={i} />
          ))}
        </motion.div>
      </AnimatePresence>
      {!(marketsQuery.isLoading || marketsQuery.isFetching) && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">{t("index.noMarkets")}</p>
        </div>
      )}

      <div className="flex justify-center mt-6">
        {marketsQuery.data && page < marketsQuery.data.totalPages && (
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-5 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
            disabled={marketsQuery.isLoading || marketsQuery.isFetching}
          >
            {marketsQuery.isFetching ? t("index.loading") : t("index.loadMore")}
          </button>
        )}
      </div>
    </AppLayout>
  );
}
