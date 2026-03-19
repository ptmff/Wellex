import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Clock, Sparkles, LayoutGrid, List } from "lucide-react";
import { MarketCard } from "@/components/MarketCard";
import { AppLayout } from "@/components/layout/AppLayout";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import { listMarkets, type BackendMarket, type ListMarketsInput } from "@/api/markets";

type Filter = "all" | "trending" | "new" | "ending";

export default function MarketsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [categoryKey, setCategoryKey] = useState<string | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const filters: { key: Filter; label: string; icon: any }[] = [
    { key: "all", label: "All", icon: Sparkles },
    { key: "trending", label: "Trending", icon: TrendingUp },
    { key: "new", label: "New", icon: Sparkles },
    { key: "ending", label: "Ending Soon", icon: Clock },
  ];

  const { request } = useAuth();

  const listLimit = filter === "new" || filter === "ending" ? 30 : 12;

  // Формируем categories из текущей страницы рынков.
  const [categories, setCategories] = useState<Array<{ key: string; name: string; id?: string }>>([{ key: "all", name: "All" }]);

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
    setCategories([{ key: "all", name: "All" }, ...arr]);
  }, [marketsQuery.data]);

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
        const t = new Date(m.createdAt).getTime();
        return Number.isFinite(t) && now - t <= windowMs;
      });
    }
    if (filter === "ending") {
      const now = Date.now();
      const windowMs = 7 * 24 * 60 * 60 * 1000;
      return data
        .filter((m) => {
          const closes = new Date(m.closesAt).getTime();
          return Number.isFinite(closes) && closes >= now && closes - now <= windowMs;
        })
        .sort((a, b) => new Date(a.closesAt).getTime() - new Date(b.closesAt).getTime());
    }
    // `trending` is already applied via backend `featured=true`.
    return categoryFiltered;
  }, [filter, marketsQuery.data, categoryKey]);

  return (
    <AppLayout>
      {/* Hero */}
      <div className="mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold mb-1">
          Prediction <span className="text-gradient">Markets</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Trade on the outcome of real-world events
        </p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "Markets", value: "248" },
          { label: "Volume 24h", value: "$12.4M" },
          { label: "Traders", value: "18.2K" },
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
            placeholder="Search..."
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
            <div className="col-span-full text-center py-12 text-muted-foreground">Loading...</div>
          ) : marketsQuery.error ? (
            <div className="col-span-full text-center py-12 text-destructive">
              {typeof (marketsQuery.error as any)?.message === "string"
                ? (marketsQuery.error as any).message
                : "Failed to load markets"}
            </div>
          ) : filtered.map((market, i) => (
            <MarketCard key={market.id} market={market as BackendMarket} index={i} />
          ))}
        </motion.div>
      </AnimatePresence>
      {!(marketsQuery.isLoading || marketsQuery.isFetching) && filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No markets found</p>
        </div>
      )}

      <div className="flex justify-center mt-6">
        {marketsQuery.data && page < marketsQuery.data.totalPages && (
          <button
            onClick={() => setPage((p) => p + 1)}
            className="px-5 py-2.5 rounded-xl bg-secondary text-foreground text-sm font-medium hover:bg-secondary/80 transition-colors"
            disabled={marketsQuery.isLoading || marketsQuery.isFetching}
          >
            {marketsQuery.isFetching ? "Loading..." : "Load more"}
          </button>
        )}
      </div>
    </AppLayout>
  );
}
