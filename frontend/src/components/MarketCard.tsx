import { Link } from "react-router-dom";
import { Clock, Users, TrendingUp } from "lucide-react";
import { motion } from "framer-motion";
import type { Market } from "@/lib/mock-data";
import { formatVolume } from "@/lib/mock-data";
import { MiniChart } from "./MiniChart";

export function MarketCard({ market, index = 0 }: { market: Market; index?: number }) {
  const probColor = market.probability >= 50 ? "text-success" : "text-danger";

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
                {market.category}
              </span>
              {market.trending && (
                <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                  <TrendingUp className="h-3 w-3" /> Hot
                </span>
              )}
              {market.isNew && (
                <span className="text-[10px] font-medium text-warning">New</span>
              )}
            </div>
            <h3 className="text-sm font-semibold leading-snug text-foreground group-hover:text-primary transition-colors line-clamp-2">
              {market.title}
            </h3>
          </div>
          <div className="shrink-0 text-right">
            <div className={`text-2xl font-bold tabular-nums ${probColor}`}>
              {market.probability}%
            </div>
            <div className="text-[10px] text-muted-foreground">chance</div>
          </div>
        </div>

        <div className="h-12 mb-3">
          <MiniChart data={market.priceHistory} up={market.probability >= 50} />
        </div>

        <div className="flex items-center gap-4 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            {formatVolume(market.volume)}
          </span>
          <span className="flex items-center gap-1">
            <Users className="h-3 w-3" />
            {market.participants.toLocaleString()}
          </span>
          <span className="flex items-center gap-1 ml-auto">
            <Clock className="h-3 w-3" />
            {market.endDate}
          </span>
        </div>
      </Link>
    </motion.div>
  );
}
