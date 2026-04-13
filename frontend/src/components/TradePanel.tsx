import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/auth/AuthContext";
import { cancelOrder, getMyOrders, getOrderBook, placeOrder, type OrderAction, type OrderSide } from "@/api/orders";
import { useI18n } from "@/i18n/I18nContext";

interface TradePanelProps {
  marketId: string;
  currentYesPrice: number; // 0..1
}

export function TradePanel({ marketId, currentYesPrice }: TradePanelProps) {
  const queryClient = useQueryClient();
  const { request, user } = useAuth();
  const { language } = useI18n();

  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [action, setAction] = useState<OrderAction>("buy");

  const sideApi: OrderSide = side === "YES" ? "yes" : "no";

  const yesCents = useMemo(() => Math.round(currentYesPrice * 100), [currentYesPrice]);
  const noCents = useMemo(() => Math.round((1 - currentYesPrice) * 100), [currentYesPrice]);

  const parsedPrice = useMemo(() => {
    const n = Number(priceInput);
    if (!Number.isFinite(n) || n <= 0 || n >= 1) return undefined;
    return n;
  }, [priceInput]);

  const parsedQuantity = useMemo(() => {
    const n = Number(quantityInput);
    if (!Number.isFinite(n) || n <= 0) return undefined;
    return n;
  }, [quantityInput]);

  const limitPrice = parsedPrice;
  const canSubmit =
    !!marketId &&
    !!request &&
    !!user &&
    parsedQuantity !== undefined &&
    Number.isFinite(limitPrice) &&
    limitPrice > 0 &&
    limitPrice < 1;
  const canTrade = canSubmit;

  const tradeMutation = useMutation({
    mutationFn: async () => {
      if (!canSubmit || parsedQuantity === undefined) return;

      return placeOrder(request, marketId, {
        side: sideApi,
        action,
        price: limitPrice,
        quantity: parsedQuantity,
      });
    },
    onSuccess: async (order) => {
      if (!order) return;
      toast.success(
        language === "ru"
          ? `Ордер размещен: ${action.toUpperCase()} ${side} @ ${Math.round(limitPrice * 100)}¢`
          : `Order placed: ${action.toUpperCase()} ${side} @ ${Math.round(limitPrice * 100)}¢`,
      );

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
      await queryClient.invalidateQueries({ queryKey: ["order-book", marketId] });
      await queryClient.invalidateQueries({ queryKey: ["my-orders", marketId] });
    },
    onError: (err) => {
      const maybeMessage = (err as { message?: unknown } | undefined)?.message;
      const message = typeof maybeMessage === "string" ? maybeMessage : language === "ru" ? "Сделка не выполнена" : "Trade failed";
      toast.error(message);
    },
  });

  const quickPrices = [0.4, 0.5, 0.6, 0.7];
  const quickQty = [1, 5, 10, 25];

  const orderBookQuery = useQuery({
    queryKey: ["order-book", marketId],
    queryFn: () => getOrderBook(request, marketId, 5),
    enabled: !!marketId && !!request,
    refetchInterval: 3000,
  });

  const myOrdersQuery = useQuery({
    queryKey: ["my-orders", marketId],
    queryFn: () => getMyOrders(request, { marketId, page: 1, limit: 20 }),
    enabled: !!marketId && !!request && !!user,
    refetchInterval: 3000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => cancelOrder(request, orderId),
    onSuccess: async () => {
      toast.success(language === "ru" ? "Ордер отменен" : "Order cancelled");
      await queryClient.invalidateQueries({ queryKey: ["my-orders", marketId] });
      await queryClient.invalidateQueries({ queryKey: ["order-book", marketId] });
    },
    onError: (err) => {
      const maybeMessage = (err as { message?: unknown } | undefined)?.message;
      toast.error(typeof maybeMessage === "string" ? maybeMessage : language === "ru" ? "Не удалось отменить" : "Cancel failed");
    },
  });

  const selectedBook = useMemo(() => {
    const b = orderBookQuery.data;
    if (!b) return { bids: [], asks: [] } as const;
    if (sideApi === "yes") return { bids: b.yesBids, asks: b.yesAsks } as const;
    return { bids: b.noBids, asks: b.noAsks } as const;
  }, [orderBookQuery.data, sideApi]);

  const myOpenOrders = useMemo(() => {
    const rows = myOrdersQuery.data?.data ?? [];
    return rows.filter((o) => ["open", "partially_filled", "pending"].includes(String(o.status)));
  }, [myOrdersQuery.data]);

  return (
    <div className="rounded-xl bg-card border border-border/50 p-4">
      <h3 className="text-sm font-semibold mb-3">{language === "ru" ? "Торговля" : "Trade"}</h3>

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
            {a === "buy" ? (language === "ru" ? "покупка" : "buy") : language === "ru" ? "продажа" : "sell"}
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

      {/* Price input */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">{language === "ru" ? "Лимитная цена (0..1)" : "Limit price (0..1)"}</label>
        <input
          type="number"
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          min={0.01}
          max={0.99}
          step={0.01}
          placeholder={side === "YES" ? "0.60" : "0.40"}
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
        <div className="flex gap-2 mt-2">
          {quickPrices.map((v) => (
            <button
              key={v}
              onClick={() => setPriceInput(String(v))}
              className="flex-1 py-1 text-xs font-medium bg-secondary rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {v.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      {/* Quantity input */}
      <div className="mb-4">
        <label className="text-xs text-muted-foreground mb-1.5 block">{language === "ru" ? "Количество (акции)" : "Quantity (shares)"}</label>
        <input
          type="number"
          value={quantityInput}
          onChange={(e) => setQuantityInput(e.target.value)}
          placeholder="0.00"
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
        <div className="flex gap-2 mt-2">
          {quickQty.map((v) => (
            <button
              key={v}
              onClick={() => setQuantityInput(String(v))}
              className="flex-1 py-1 text-xs font-medium bg-secondary rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="space-y-2 mb-4 text-xs">
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Лимитная цена" : "Limit price"}</span>
          <span className="text-foreground font-medium">{parsedPrice !== undefined ? `${Math.round(parsedPrice * 100)}¢` : "—"}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Акции" : "Shares"}</span>
          <span className="text-foreground font-medium">{parsedQuantity !== undefined ? parsedQuantity.toFixed(4) : "—"}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Номинал" : "Notional"}</span>
          <span className="text-success font-medium">{parsedPrice !== undefined && parsedQuantity !== undefined ? `$${(parsedPrice * parsedQuantity).toFixed(2)}` : "—"}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Тип" : "Rule"}</span>
          <span className="text-foreground font-medium">{language === "ru" ? "Лимитный ордер" : "Limit order"}</span>
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
        disabled={!canTrade || tradeMutation.isPending}
        onClick={() => {
          if (!user) {
            toast.error(language === "ru" ? "Войдите, чтобы торговать." : "Please login to trade.");
            return;
          }
          tradeMutation.mutate();
        }}
      >
        {tradeMutation.isPending ? (language === "ru" ? "Отправка..." : "Submitting...") : action === "buy" ? (language === "ru" ? "Купить" : "Buy") : language === "ru" ? "Продать" : "Sell"} {side}
      </motion.button>

      <div className="mt-5 pt-4 border-t border-border/50">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">{language === "ru" ? "Стакан ордеров" : "Order Book"} ({side})</h4>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground mb-1">{language === "ru" ? "Покупка" : "Bids"}</div>
            <div className="space-y-1">
              {selectedBook.bids.slice(0, 5).map((lvl, idx) => (
                <div key={`b-${idx}`} className="flex justify-between">
                  <span className="text-success">{Math.round(lvl.price * 100)}¢</span>
                  <span>{lvl.quantity.toFixed(2)}</span>
                </div>
              ))}
              {selectedBook.bids.length === 0 ? <div className="text-muted-foreground">{language === "ru" ? "Нет заявок" : "No bids"}</div> : null}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">{language === "ru" ? "Продажа" : "Asks"}</div>
            <div className="space-y-1">
              {selectedBook.asks.slice(0, 5).map((lvl, idx) => (
                <div key={`a-${idx}`} className="flex justify-between">
                  <span className="text-danger">{Math.round(lvl.price * 100)}¢</span>
                  <span>{lvl.quantity.toFixed(2)}</span>
                </div>
              ))}
              {selectedBook.asks.length === 0 ? <div className="text-muted-foreground">{language === "ru" ? "Нет заявок" : "No asks"}</div> : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5 pt-4 border-t border-border/50">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">{language === "ru" ? "Мои открытые ордера" : "My Open Orders"}</h4>
        <div className="space-y-2 max-h-52 overflow-auto pr-1">
          {myOpenOrders.map((o) => (
            <div key={o.id} className="rounded-md bg-secondary/60 px-2 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {String(o.action).toUpperCase()} {String(o.side).toUpperCase()} @ {Math.round(o.price * 100)}¢
                </span>
                <button
                  className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                  onClick={() => cancelMutation.mutate(o.id)}
                  disabled={cancelMutation.isPending}
                >
                  {language === "ru" ? "Отмена" : "Cancel"}
                </button>
              </div>
              <div className="text-muted-foreground mt-1">
                {language === "ru" ? "Кол-во" : "Qty"} {o.quantity.toFixed(4)} |{" "}
                {language === "ru" ? "Исполнено" : "Filled"} {o.filledQuantity.toFixed(4)} |{" "}
                {language === "ru" ? "Осталось" : "Remaining"} {o.remainingQuantity.toFixed(4)}
              </div>
            </div>
          ))}
          {!user ? <div className="text-xs text-muted-foreground">{language === "ru" ? "Войдите, чтобы увидеть ордера" : "Login to view your orders"}</div> : null}
          {user && !myOrdersQuery.isLoading && myOpenOrders.length === 0 ? (
            <div className="text-xs text-muted-foreground">{language === "ru" ? "Нет открытых ордеров" : "No open orders"}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
