import { accountKey, invalidatePortfolio } from "@/auth/accountQueries";
import { useId, useState } from "react";
import { motion } from "framer-motion";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/auth/useAuth";
import { cancelOrder, getMyOrders, getOrderBook, placeOrder, type OrderAction, type PlaceOrderInput } from "@/api/orders";
import { useI18n } from "@/i18n/useI18n";
import { formatWx } from "@/lib/money";
import { Link, useLocation } from "react-router-dom";
import { QueryError } from "@/components/QueryError";
import { Button } from "@/components/ui/button";
import type { PortfolioSummaryResponse } from "@/lib/portfolio";

interface TradePanelProps {
  marketId: string;
  currentYesPrice: number; // 0..1
  currentNoPrice: number;
  blockedReason?: string;
  closesAt?: number;
  live: boolean;
}

export function TradePanel({ marketId, currentYesPrice, currentNoPrice, blockedReason, closesAt, live }: TradePanelProps) {
  const queryClient = useQueryClient();
  const { request, user, isLoading: isAuthLoading } = useAuth();
  const { pathname, search, hash } = useLocation();
  const { language, locale } = useI18n();
  const fieldId = useId();
  const marketPath = pathname + search + hash;

  const [side, setSide] = useState<"YES" | "NO">("YES");
  const [priceInput, setPriceInput] = useState("");
  const [quantityInput, setQuantityInput] = useState("");
  const [action, setAction] = useState<OrderAction>("buy");

  const sideApi = side === "YES" ? "yes" : "no";
  const formatPrice = (price: number) =>
    `${(price * 100).toLocaleString(locale, { maximumFractionDigits: 6 })}¢`;
  const price = Number(priceInput.replace(",", "."));
  const quantity = Number(quantityInput.replace(",", "."));
  const parsedPrice = Number.isFinite(price) && price > 0 && price < 1 ? price : undefined;
  const parsedQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : undefined;

  const tradeMutation = useMutation({
    mutationFn: (input: PlaceOrderInput) => placeOrder(request, marketId, input),
    onSuccess: async (order) => {
      toast.success(
        language === "ru"
          ? `Ордер принят: ${order.side.toUpperCase()} по ${formatPrice(order.price)}. Исполнено ${order.filledQuantity} из ${order.quantity}.`
          : `Order accepted: ${order.side.toUpperCase()} at ${formatPrice(order.price)}. Filled ${order.filledQuantity} of ${order.quantity}.`,
      );
      await Promise.all([
        invalidatePortfolio(queryClient, user?.id),
        queryClient.invalidateQueries({ queryKey: accountKey(user?.id, "my-orders", marketId) }),
        ...["market", "market-stats", "market-price-line", "order-book"].map(
          (key) => queryClient.invalidateQueries({ queryKey: [key, marketId] }),
        ),
      ]);
    },
    onError: (err) => {
      if (err?.name === "AbortError") return;
      const code = (err as { code?: unknown } | undefined)?.code;
      const maybeMessage = (err as { message?: unknown } | undefined)?.message;
      if (code === "INSUFFICIENT_BALANCE") {
        toast.error(
          language === "ru"
            ? "Недостаточно WX. Докупите валюту или посмотрите рекламу."
            : "Not enough WX. Buy more or watch an ad.",
        );
        return;
      }
      const message = typeof maybeMessage === "string" ? maybeMessage : language === "ru" ? "Сделка не выполнена" : "Trade failed";
      toast.error(message);
    },
  });

  const quickPrices = [0.4, 0.5, 0.6, 0.7];
  const quickQty = [1, 5, 10, 25];

  const portfolioQuery = useQuery({
    queryKey: accountKey(user?.id, "portfolio"),
    queryFn: () => request<PortfolioSummaryResponse>("/portfolio", { method: "GET" }),
    enabled: !!request && !!user,
  });
  const availableWx = portfolioQuery.data?.balance.available;

  const orderBookQuery = useQuery({
    queryKey: ["order-book", marketId],
    queryFn: () => getOrderBook(request, marketId, 5),
    enabled: !!marketId && !!request,
    refetchInterval: live ? 15_000 : 5000,
  });

  const myOrdersQuery = useQuery({
    queryKey: accountKey(user?.id, "my-orders", marketId),
    queryFn: () => getMyOrders(request, { marketId, page: 1, limit: 20 }),
    enabled: !!marketId && !!request && !!user,
    refetchInterval: live ? 15_000 : 5000,
  });

  const cancelMutation = useMutation({
    mutationFn: async (orderId: string) => cancelOrder(request, orderId),
    onSuccess: async () => {
      toast.success(language === "ru" ? "Ордер отменен" : "Order cancelled");
      await Promise.all([
        invalidatePortfolio(queryClient, user?.id),
        queryClient.invalidateQueries({ queryKey: accountKey(user?.id, "my-orders", marketId) }),
        queryClient.invalidateQueries({ queryKey: ["order-book", marketId] }),
      ]);
    },
    onError: (err) => {
      if (err?.name === "AbortError") return;
      const maybeMessage = (err as { message?: unknown } | undefined)?.message;
      toast.error(typeof maybeMessage === "string" ? maybeMessage : language === "ru" ? "Не удалось отменить" : "Cancel failed");
    },
  });

  const book = orderBookQuery.data;
  const bids = (sideApi === "yes" ? book?.yesBids : book?.noBids) ?? [];
  const asks = (sideApi === "yes" ? book?.yesAsks : book?.noAsks) ?? [];
  const myOpenOrders = user
    ? (myOrdersQuery.data?.data ?? []).filter((order) => ["open", "partially_filled", "pending"].includes(order.status))
    : [];

  return (
    <div className="rounded-xl bg-card border border-border/50 p-4">
      <h3 className="text-sm font-semibold mb-3">{language === "ru" ? "Торговля" : "Trade"}</h3>

      <form onSubmit={(event) => {
        event.preventDefault();
        if (!user || blockedReason || (closesAt !== undefined && Date.now() >= closesAt) || parsedPrice === undefined || parsedQuantity === undefined || tradeMutation.isPending) return;
        tradeMutation.mutate({ side: sideApi, action, price: parsedPrice, quantity: parsedQuantity });
      }}>
      {/* Buy/Sell toggle */}
      <div className="flex gap-1 p-0.5 bg-secondary rounded-lg mb-3">
        {(["buy", "sell"] as const).map((a) => (
          <button
            key={a}
            type="button"
            aria-pressed={action === a}
            onClick={() => setAction(a)}
            className={`flex-1 min-h-10 py-1.5 text-xs font-medium rounded-md capitalize transition-all duration-200 ${
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
            type="button"
            aria-pressed={side === s}
            onClick={() => setSide(s)}
            className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 ${
              side === s
                ? s === "YES"
                  ? "bg-success/15 text-success border border-success/30"
                  : "bg-danger/15 text-danger border border-danger/30"
                : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
            }`}
          >
            {s} {formatPrice(s === "YES" ? currentYesPrice : currentNoPrice)}
          </button>
        ))}
      </div>

      {/* Price input */}
      <div className="mb-4">
        <label htmlFor={`${fieldId}-price`} className="text-xs text-muted-foreground mb-1.5 block">{language === "ru" ? "Лимитная цена (0..1)" : "Limit price (0..1)"}</label>
        <input
          id={`${fieldId}-price`}
          inputMode="decimal"
          aria-invalid={priceInput !== "" && parsedPrice === undefined}
          aria-describedby={priceInput !== "" && parsedPrice === undefined ? `${fieldId}-price-error` : undefined}
          value={priceInput}
          onChange={(e) => setPriceInput(e.target.value)}
          placeholder={side === "YES" ? "0.60" : "0.40"}
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
        {priceInput !== "" && parsedPrice === undefined && (
          <p id={`${fieldId}-price-error`} className="mt-1 text-xs text-destructive">
            {language === "ru" ? "Введите цену больше 0 и меньше 1." : "Enter a price greater than 0 and less than 1."}
          </p>
        )}
        <div className="flex gap-2 mt-2">
          {quickPrices.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPriceInput(String(v))}
              className="flex-1 min-h-10 py-1 text-xs font-medium bg-secondary rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              {v.toFixed(2)}
            </button>
          ))}
        </div>
      </div>

      {/* Quantity input */}
      <div className="mb-4">
        <label htmlFor={`${fieldId}-quantity`} className="text-xs text-muted-foreground mb-1.5 block">{language === "ru" ? "Количество (акции)" : "Quantity (shares)"}</label>
        <input
          id={`${fieldId}-quantity`}
          inputMode="decimal"
          aria-invalid={quantityInput !== "" && parsedQuantity === undefined}
          aria-describedby={quantityInput !== "" && parsedQuantity === undefined ? `${fieldId}-quantity-error` : undefined}
          value={quantityInput}
          onChange={(e) => setQuantityInput(e.target.value)}
          placeholder="0.00"
          className="w-full bg-secondary rounded-lg px-3 py-2.5 text-base sm:text-sm text-foreground placeholder:text-muted-foreground outline-none focus:ring-1 focus:ring-primary/50 transition-all"
        />
        {quantityInput !== "" && parsedQuantity === undefined && (
          <p id={`${fieldId}-quantity-error`} className="mt-1 text-xs text-destructive">
            {language === "ru" ? "Введите количество больше 0." : "Enter a quantity greater than 0."}
          </p>
        )}
        <div className="flex gap-2 mt-2">
          {quickQty.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setQuantityInput(String(v))}
              className="flex-1 min-h-10 py-1 text-xs font-medium bg-secondary rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
          <span className="text-foreground font-medium">{parsedPrice !== undefined ? formatPrice(parsedPrice) : "—"}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Акции" : "Shares"}</span>
          <span className="text-foreground font-medium">{parsedQuantity !== undefined ? parsedQuantity.toFixed(4) : "—"}</span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Сумма без комиссии" : "Amount before fees"}</span>
          <span className="text-success font-medium">{parsedPrice !== undefined && parsedQuantity !== undefined ? formatWx(parsedPrice * parsedQuantity) : "—"}</span>
        </div>
        {user ? (
          <div className="flex justify-between text-muted-foreground">
            <span>{language === "ru" ? "Баланс" : "Balance"}</span>
            <span className="text-foreground font-medium">{availableWx === undefined ? "—" : formatWx(availableWx)}</span>
          </div>
        ) : null}
        <div className="flex justify-between text-muted-foreground">
          <span>{language === "ru" ? "Тип" : "Type"}</span>
          <span className="text-foreground font-medium">{language === "ru" ? "Лимитный ордер" : "Limit order"}</span>
        </div>
      </div>

      {blockedReason ? (
        <p role="status" className="rounded-lg bg-secondary p-3 text-sm">{blockedReason}</p>
      ) : isAuthLoading ? (
        <p role="status" className="py-2 text-sm text-muted-foreground">{language === "ru" ? "Проверяем вход…" : "Checking sign-in…"}</p>
      ) : !user ? (
        <Button asChild className="w-full min-h-11">
          <Link to="/login" state={{ from: marketPath }}>{language === "ru" ? "Войти, чтобы торговать" : "Log in to trade"}</Link>
        </Button>
      ) : (
        <motion.button
          type="submit"
          whileTap={{ scale: 0.98 }}
          className={`w-full py-3 rounded-lg text-sm font-semibold disabled:opacity-50 ${
            side === "YES" ? "bg-success text-success-foreground" : "bg-danger text-danger-foreground"
          }`}
          disabled={parsedPrice === undefined || parsedQuantity === undefined || tradeMutation.isPending}
        >
          {tradeMutation.isPending
            ? language === "ru" ? "Отправка…" : "Submitting…"
            : action === "buy" ? language === "ru" ? "Купить" : "Buy" : language === "ru" ? "Продать" : "Sell"} {side}
        </motion.button>
      )}
      </form>
      {user && !blockedReason && action === "buy" && availableWx === 0 ? (
        <Link to="/shop" className="mt-2 block text-center text-xs text-primary hover:underline">
          {language === "ru" ? "Баланс пуст — магазин и реклама" : "Empty balance — shop or watch an ad"}
        </Link>
      ) : null}

      <div className="mt-5 pt-4 border-t border-border/50">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">{language === "ru" ? "Стакан ордеров" : "Order Book"} ({side})</h4>
        {orderBookQuery.isError && (
          <QueryError
            message={language === "ru" ? "Не удалось обновить стакан." : "Could not update the order book."}
            retry={() => void orderBookQuery.refetch()}
            busy={orderBookQuery.isFetching}
          />
        )}
        {orderBookQuery.isLoading && (
          <p role="status" className="text-xs text-muted-foreground">{language === "ru" ? "Загружаем стакан…" : "Loading order book…"}</p>
        )}
        {book && <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <div className="text-muted-foreground mb-1">{language === "ru" ? "Покупка" : "Bids"}</div>
            <div className="space-y-1">
              {bids.slice(0, 5).map((lvl, idx) => (
                <div key={`b-${idx}`} className="flex justify-between">
                  <span className="text-success">{formatPrice(lvl.price)}</span>
                  <span>{lvl.quantity.toFixed(2)}</span>
                </div>
              ))}
              {bids.length === 0 ? <div className="text-muted-foreground">{language === "ru" ? "Нет заявок" : "No bids"}</div> : null}
            </div>
          </div>
          <div>
            <div className="text-muted-foreground mb-1">{language === "ru" ? "Продажа" : "Asks"}</div>
            <div className="space-y-1">
              {asks.slice(0, 5).map((lvl, idx) => (
                <div key={`a-${idx}`} className="flex justify-between">
                  <span className="text-danger">{formatPrice(lvl.price)}</span>
                  <span>{lvl.quantity.toFixed(2)}</span>
                </div>
              ))}
              {asks.length === 0 ? <div className="text-muted-foreground">{language === "ru" ? "Нет заявок" : "No asks"}</div> : null}
            </div>
          </div>
        </div>}
      </div>

      <div className="mt-5 pt-4 border-t border-border/50">
        <h4 className="text-xs font-semibold text-muted-foreground mb-2">{language === "ru" ? "Мои открытые ордера" : "My Open Orders"}</h4>
        <div className="space-y-2 max-h-52 overflow-auto pr-1">
          {myOpenOrders.map((o) => (
            <div key={o.id} className="rounded-md bg-secondary/60 px-2 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {String(o.action).toUpperCase()} {String(o.side).toUpperCase()} @ {formatPrice(o.price)}
                </span>
                <button
                  className="min-h-10 px-2 text-muted-foreground hover:text-foreground disabled:opacity-50"
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
          {user && myOrdersQuery.isLoading && (
            <div role="status" className="text-xs text-muted-foreground">{language === "ru" ? "Загружаем ордера…" : "Loading orders…"}</div>
          )}
          {user && myOrdersQuery.isError && (
            <QueryError
              message={language === "ru" ? "Не удалось обновить ордера." : "Could not update your orders."}
              retry={() => void myOrdersQuery.refetch()}
              busy={myOrdersQuery.isFetching}
            />
          )}
          {user && myOrdersQuery.isSuccess && myOpenOrders.length === 0 ? (
            <div className="text-xs text-muted-foreground">{language === "ru" ? "Нет открытых ордеров" : "No open orders"}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
