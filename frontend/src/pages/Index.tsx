import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { TrendingUp, Clock, Sparkles, LayoutGrid, List } from "lucide-react";
import { markets, categories } from "@/lib/mock-data";
import { MarketCard } from "@/components/MarketCard";
import { AppLayout } from "@/components/layout/AppLayout";

type Filter = "all" | "trending" | "new" | "ending";

export default function MarketsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [category, setCategory] = useState("All");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const filters: { key: Filter; label: string; icon: any }[] = [
    { key: "all", label: "All", icon: Sparkles },
    { key: "trending", label: "Trending", icon: TrendingUp },
    { key: "new", label: "New", icon: Sparkles },
    { key: "ending", label: "Ending Soon", icon: Clock },
  ];

  let filtered = markets;
  if (filter === "trending") filtered = filtered.filter((m) => m.trending);
  if (filter === "new") filtered = filtered.filter((m) => m.isNew);
  if (filter === "ending") filtered = filtered.sort((a, b) => new Date(a.endDate).getTime() - new Date(b.endDate).getTime());
  if (category !== "All") filtered = filtered.filter((m) => m.category === category);

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
            onClick={() => setFilter(f.key)}
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

        <div className="ml-auto flex gap-1 shrink-0">
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
            key={cat}
            onClick={() => setCategory(cat)}
            className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 ${
              category === cat
                ? "bg-accent text-foreground border border-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      <AnimatePresence mode="wait">
        <motion.div
          key={`${filter}-${category}`}
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
          {filtered.map((market, i) => (
            <MarketCard key={market.id} market={market} index={i} />
          ))}
        </motion.div>
      </AnimatePresence>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-muted-foreground">
          <p className="text-sm">No markets found</p>
        </div>
      )}
    </AppLayout>
  );
}
