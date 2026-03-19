import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Clock, Users, TrendingUp, Droplets, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { markets, formatVolume } from "@/lib/mock-data";
import { AppLayout } from "@/components/layout/AppLayout";
import { PriceChart } from "@/components/PriceChart";
import { TradePanel } from "@/components/TradePanel";

export default function MarketDetail() {
  const { id } = useParams();
  const market = markets.find((m) => m.id === id);

  if (!market) {
    return (
      <AppLayout>
        <div className="text-center py-20 text-muted-foreground">Market not found</div>
      </AppLayout>
    );
  }

  const probColor = market.probability >= 50 ? "text-success" : "text-danger";

  return (
    <AppLayout>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}>
        {/* Back */}
        <Link
          to="/"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" /> Back to markets
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main */}
          <div className="lg:col-span-2 space-y-4">
            {/* Header */}
            <div className="rounded-xl bg-card border border-border/50 p-5">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground bg-secondary px-2 py-0.5 rounded-md">
                  {market.category}
                </span>
                {market.trending && (
                  <span className="text-[10px] font-medium text-primary flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" /> Trending
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl font-bold mb-3">{market.title}</h1>

              <div className="flex items-center gap-6 flex-wrap">
                <div>
                  <span className={`text-3xl font-bold ${probColor}`}>{market.probability}%</span>
                  <span className="text-xs text-muted-foreground ml-1.5">chance</span>
                </div>

                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" /> {formatVolume(market.volume)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Droplets className="h-3.5 w-3.5" /> {formatVolume(market.liquidity)}
                  </span>
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" /> {market.participants.toLocaleString()}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" /> {market.endDate}
                  </span>
                </div>

                <button className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            </div>

            {/* Chart */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-semibold">Price History</h2>
                <div className="flex gap-1">
                  {["1D", "1W", "1M", "All"].map((t) => (
                    <button
                      key={t}
                      className={`px-2.5 py-1 text-[11px] rounded-md font-medium transition-colors ${
                        t === "1M"
                          ? "bg-accent text-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <PriceChart data={market.priceHistory} />
            </div>

            {/* Activity */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h2 className="text-sm font-semibold mb-3">Recent Activity</h2>
              <div className="space-y-2">
                {market.recentTrades.map((trade, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center justify-between py-2 border-b border-border/30 last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      <div className="h-7 w-7 rounded-full bg-secondary flex items-center justify-center text-xs font-medium text-muted-foreground">
                        {trade.user.slice(0, 4)}
                      </div>
                      <div>
                        <span className="text-xs text-muted-foreground">{trade.user}</span>
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="text-muted-foreground">bought</span>
                          <span className={trade.side === "YES" ? "text-success font-medium" : "text-danger font-medium"}>
                            {trade.side}
                          </span>
                          <span className="text-muted-foreground">at {trade.price}¢</span>
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-medium">${trade.amount}</div>
                      <div className="text-[10px] text-muted-foreground">{trade.time}</div>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </div>

          {/* Sidebar - Trade */}
          <div className="space-y-4">
            <TradePanel probability={market.probability} />

            {/* Market Stats */}
            <div className="rounded-xl bg-card border border-border/50 p-4">
              <h3 className="text-sm font-semibold mb-3">Market Info</h3>
              <div className="space-y-2.5 text-xs">
                {[
                  { label: "Volume", value: formatVolume(market.volume) },
                  { label: "Liquidity", value: formatVolume(market.liquidity) },
                  { label: "Participants", value: market.participants.toLocaleString() },
                  { label: "End Date", value: market.endDate },
                  { label: "Resolution", value: "Oracle" },
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
