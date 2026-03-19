import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { executeTrade, getTradeQuote, type TradeAction, type TradeExecuteInput, type TradeQuoteResponse, type TradeSide } from "@/api/trading";

interface TradePanelProps {
  marketId: string;
  currentYesPrice: number; // 0..1
}

export function TradePanel({ marketId, currentYesPrice }: TradePanelProps) {
  const queryClient = useQueryClient();
  const { request, user } = useAuth();

  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [amount, setAmount] = useState("");
  const [action, setAction] = useState<TradeAction>("buy");
  const [maxSlippage, setMaxSlippage] = useState<number>(2);

  const sideApi: TradeSide = side === "YES" ? "yes" : "no";

  const yesCents = useMemo(() => Math.round(currentYesPrice * 100), [currentYesPrice]);
  const noCents = useMemo(() => Math.round((1 - currentYesPrice) * 100), [currentYesPrice]);

  const parsedAmount = useMemo(() => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
  }, [amount]);

  // Debounce to avoid hammering quote endpoint while typing.
  const [debouncedAmount, setDebouncedAmount] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (parsedAmount === undefined) {
      setDebouncedAmount(undefined);
      return;
    }
    const t = window.setTimeout(() => setDebouncedAmount(parsedAmount), 350);
    return () => window.clearTimeout(t);
  }, [parsedAmount]);

  const quoteQuery = useQuery<TradeQuoteResponse>({
    queryKey: ["trade-quote", marketId, sideApi, action, debouncedAmount],
    enabled: !!marketId && !!request && !!debouncedAmount,
    staleTime: 500,
    retry: false,
    keepPreviousData: true,
    queryFn: async () => {
      return getTradeQuote(request, marketId, {
        side: sideApi,
        action,
        amount: debouncedAmount!,
      });
    },
  });

  const quote = quoteQuery.data;

  const expectedPrice = quote?.averagePrice;

  const isQuoteForCurrentAmount = useMemo(() => {
    if (parsedAmount === undefined || debouncedAmount === undefined) return false;
    return Math.abs(debouncedAmount - parsedAmount) < 1e-9;
  }, [parsedAmount, debouncedAmount]);

  const canTrade = !!marketId && !!request && !!user && parsedAmount !== undefined && quote !== undefined && isQuoteForCurrentAmount;

  const tradeMutation = useMutation({
    mutationFn: async () => {
      if (!canTrade || expectedPrice === undefined || parsedAmount === undefined) return;

      const payload: TradeExecuteInput = {
        side: sideApi,
        action,
        amount: parsedAmount,
        maxSlippage: Number.isFinite(maxSlippage) ? Math.max(0, Math.min(50, maxSlippage)) : 2,
        expectedPrice,
      };

      return executeTrade(request, marketId, payload);
    },
    onSuccess: async (result) => {
      if (!result) return;
      toast.success(`Trade executed (avg price: ${Math.round(result.averagePrice * 100)}¢)`);

      // Market-derived UI: refresh chart/stats and recent trades.
      await queryClient.invalidateQueries({ queryKey: ["market", marketId] });
      await queryClient.invalidateQueries({ queryKey: ["market-stats", marketId] });
      await queryClient.invalidateQueries({ queryKey: ["market-price-line", marketId] });

      // Portfolio-derived UI: refresh overview, positions, trades and history.
      await queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-positions"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-pnl"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-trades"] });
      await queryClient.invalidateQueries({ queryKey: ["portfolio-balance-history"] });
    },
    onError: (err) => {
      const maybeMessage = (err as { message?: unknown } | undefined)?.message;
      const message = typeof maybeMessage === "string" ? maybeMessage : "Trade failed";
      toast.error(message);
    },
  });

  const amountLabel = action === "buy" ? "Amount ($)" : "Shares to sell";
  const quickAmounts = action === "buy" ? [10, 25, 50, 100] : [1, 5, 10, 25];

  return (
    <div className="rounded-xl bg-card border border-border/50 p-4">
      <h3 className="text-sm font-semibold mb-3">Trade</h3>

      {/* Buy/Sell toggle */}
      <div className="flex gap-1 p-0.5 bg-secondary rounded-lg mb-3">
        {(["buy", "sell"] as const).map((a) => (
          <button
            key={a}
            onClick={() => setAction(a)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-md capitalize transition-all duration-200 ${
              action === a
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {a}
          </button>
        ))}
      </div>

      {/* YES/NO toggle */}
      <div className="flex gap-2 mb-4">
        {(["YES", "NO"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setSide(s)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
              side === s
                ? s === "YES"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-danger/15 text-danger border border-danger/30"
                : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {s} {s === "YES" ? `${yesCents}¢` : `${noCents}¢`}
          </button>
        ))}
      </div>

      {/* Amount input */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">{amountLabel}</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
        <div className="flex gap-2 mt-2">
          {quickAmounts.map((v) => (
            <button
              key={v}
              onClick={() => setAmount(String(v))}
              className="flex-1 py-1 text-xs font-medium bg-secondary rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {action === "buy" ? `$${v}` : `${v}`}
            </button>
          ))}
        </div>
      </div>

      {/* Slippage */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">Max slippage (%)</label>
        <input
          type="number"
          min={0}
          max={50}
          step={0.5}
          value={maxSlippage}
          onChange={(e) => setMaxSlippage(Number(e.target.value))}
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
      </div>

      {/* Summary */}
      <div className="space-y-2 mb-4 text-xs">
        <div className="flex justify-between text-muted-foreground">
          <span>Est. avg price</span>
          <span className="text-foreground font-medium">
            {quoteQuery.isLoading ? "…" : quote ? `${Math.round(quote.averagePrice * 100)}¢` : "—"}
          </span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{action === "buy" ? "Est. shares" : "Est. shares sold"}</span>
          <span className="text-foreground font-medium">
            {quoteQuery.isLoading ? "…" : quote ? quote.shares.toFixed(4) : "—"}
          </span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{action === "buy" ? "Est. cost" : "Est. proceeds"}</span>
          <span className="text-success font-medium">
            {quoteQuery.isLoading ? "…" : quote ? `$${quote.totalCost.toFixed(2)}` : "—"}
          </span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>Price impact</span>
          <span className="text-foreground font-medium">
            {quoteQuery.isLoading ? "…" : quote ? `${quote.priceImpact.toFixed(2)}%` : "—"}
          </span>
        </div>
      </div>

      {/* Submit */}
      <motion.button
        whileTap={{ scale: 0.98 }}
        className={`w-full py-3 rounded-lg text-sm font-semibold transition-all duration-200 ${
          side === "YES"
            ? "bg-success text-success-foreground hover:brightness-110"
            : "bg-danger text-danger-foreground hover:brightness-110"
        }`}
        disabled={!canTrade || quoteQuery.isFetching || tradeMutation.isPending}
        onClick={() => {
          if (!user) {
            toast.error("Please login to trade.");
            return;
          }
          tradeMutation.mutate();
        }}
      >
        {tradeMutation.isPending ? "Submitting..." : action === "buy" ? "Buy" : "Sell"} {side}
      </motion.button>
    </div>
  );
}
