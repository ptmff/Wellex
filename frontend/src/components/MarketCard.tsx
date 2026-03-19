import { Link } from "react-router-dom";
import { Clock, Users, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import { formatVolume } from "@/lib/mock-data";
import { MiniChart } from "./MiniChart";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/AuthContext";
import type { BackendMarket } from "@/api/markets";
import { getMarketPriceLine } from "@/api/markets";

export function MarketCard({ market, index = 0 }: { market: BackendMarket; index?: number }) {
  const { request } = useAuth();
  const probabilityPct = Math.round(market.prices.yes * 100);
  const probColor = probabilityPct >= 50 ? "text-success" : "text-danger";
  const isNew = (() => {
    const now = Date.now();
    const created = new Date(market.createdAt).getTime();
    return now - created <= 7 * 24 * 60 * 60 * 1000;
  })();

  const { data: miniChartData } = useQuery({
    queryKey: ["market-mini-chart", market.id],
    queryFn: () => getMarketPriceLine(request, market.id, { points: 24 }).then((pts) =>
      pts.map((p) => ({
        time: new Date(p.time * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        yes: Math.round(p.yesPrice * 100),
      })),
    ),
    enabled: !!request,
    staleTime: 60_000,
  });

  const closesLabel = useMemoClosesLabel(market.closesAt);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, duration: 0.3 }}
    >
      <Link
        to={`/market/${market.id}`}
        className="group block rounded-xl bg-card border border-border/50 p-4 hover:border-border transition-all duration-200 hover:bg-card-hover"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                {market.category?.name ?? "Uncategorized"}
              </span>
              {market.isFeatured && (
                <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                  <TrendingUp className="h-3 w-3" /> Hot
                </span>
              )}
              {isNew && (
                <span className="text-[10px] font-medium text-warning">New</span>
              )}
            </div>
            <h3 className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {market.title}
            </h3>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-2xl font-bold tabular-nums ${probColor}`}>
              {probabilityPct}%
            </div>
            <div className="text-[10px] text-muted-foreground">chance</div>
          </div>
        </div>

        <div className="h-12 mb-3">
          {miniChartData && miniChartData.length ? (
            <MiniChart data={miniChartData} up={probabilityPct >= 50} />
          ) : (
            <div className="h-full w-full rounded-md bg-secondary/30" aria-hidden />
          )}
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {formatVolume(market.stats.volume24h)}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {market.stats.tradeCount.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3" />
            {closesLabel}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}

function useMemoClosesLabel(closesAt: string) {
  // Keep it as a plain helper to avoid pulling in additional state.
  try {
    return new Date(closesAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  } catch {
    return "TBD";
  }
}
