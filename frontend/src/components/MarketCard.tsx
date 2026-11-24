import { Link } from "react-router-dom";
import { Clock, Users, TrendingUp } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { formatVolume } from "@/lib/money";
import { MiniChart } from "./MiniChart";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
import type { BackendMarket } from "@/api/markets";
import { getMarketPriceLine } from "@/api/markets";
import { formatDateToLocaleDateString, parseDate } from "@/lib/date";
import { useI18n } from "@/i18n/useI18n";

export function MarketCard({ market }: { market: BackendMarket }) {
  const { request } = useAuth();
  const { language } = useI18n();
  const probabilityPct = Math.round(market.prices.yes * 100);
  const probColor = probabilityPct >= 50 ? "text-success" : "text-danger";
  const createdAt = parseDate(market.createdAt)?.getTime();
  const isNew = createdAt !== undefined && createdAt <= Date.now() && Date.now() - createdAt <= 7 * 24 * 60 * 60 * 1000;
  const chartRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const element = chartRef.current;
    if (!element || nearViewport) return;
    if (typeof IntersectionObserver === "undefined") {
      setNearViewport(true);
      return;
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return;
      setNearViewport(true);
      observer.disconnect();
    }, { rootMargin: "120px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [nearViewport]);

  const { data: miniChartData } = useQuery({
    queryKey: ["market-mini-chart", market.id],
    queryFn: ({ signal }) => getMarketPriceLine(request, market.id, { points: 24, signal }),
    enabled: nearViewport,
    staleTime: 60_000,
    retry: false,
  });

  const closesLabel = useClosesLabel(market.closesAt);

  return (
    <Link
      to={`/market/${market.id}`}
      className="group block rounded-xl bg-card border border-border/50 p-4 hover:border-border transition-all duration-200 hover:bg-card-hover"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-secondary [overflow-wrap:anywhere] px-2 py-0.5 rounded-md">
              {market.category?.name ?? (language === "ru" ? "Без категории" : "Uncategorized")}
            </span>
            {market.isFeatured && (
              <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                <TrendingUp className="h-3 w-3" /> {language === "ru" ? "Горячее" : "Hot"}
              </span>
            )}
            {market.source === "polymarket" && (
              <span className="text-[10px] font-medium text-muted-foreground">PM</span>
            )}
            {isNew && (
              <span className="text-[10px] font-medium text-warning">{language === "ru" ? "Новое" : "New"}</span>
            )}
          </div>
          <h3 className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2 [overflow-wrap:anywhere]">
            {market.title}
          </h3>
        </div>
        <div className="shrink-0 text-right">
          <div className={`text-2xl font-bold tabular-nums ${probColor}`}>
            {probabilityPct}%
          </div>
          <div className="text-[10px] text-muted-foreground">{language === "ru" ? "шанс" : "chance"}</div>
        </div>
      </div>

      <div ref={chartRef} className="mb-3 h-12">
        {miniChartData && miniChartData.length > 1 ? (
          <MiniChart prices={miniChartData.map((point) => point.yesPrice)} up={probabilityPct >= 50} />
        ) : (
          <div className="h-full w-full rounded-md bg-secondary/30" aria-hidden />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
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
  );
}

function useClosesLabel(closesAt: unknown) {
  const { locale } = useI18n();
  return formatDateToLocaleDateString(closesAt, locale, { month: "short", day: "numeric" });
}
