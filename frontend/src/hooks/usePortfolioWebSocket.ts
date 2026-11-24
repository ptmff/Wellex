import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/auth/useAuth";
import { accountKey } from "@/auth/accountQueries";
import { getAccessToken } from "@/auth/session";
import { WS_BASE_URL } from "@/config";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function usePortfolioWebSocket({
  enabled,
  marketIds,
}: {
  enabled: boolean;
  marketIds: string[];
}) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [live, setLive] = useState(false);
  const desiredMarkets = useRef(new Set<string>());
  const syncMarkets = useRef<(() => void) | null>(null);

  useEffect(() => {
    desiredMarkets.current = new Set(marketIds);
    syncMarkets.current?.();
  }, [marketIds]);

  useEffect(() => {
    setLive(false);
    if (!enabled) return;
    const userId = user?.id;

    let socket: WebSocket | undefined;
    let reconnectTimer: number | undefined;
    let updateTimer: number | undefined;
    let attempts = 0;
    let disposed = false;
    const activeMarkets = new Set<string>();
    const subscribedMarkets = new Set<string>();
    const updates = new Map<string, readonly unknown[]>();

    function flushUpdates() {
      updateTimer = undefined;
      for (const queryKey of updates.values()) {
        void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
      }
      updates.clear();
    }

    function invalidate(queryKey: readonly unknown[]) {
      updates.set(JSON.stringify(queryKey), queryKey);
      updateTimer ??= window.setTimeout(flushUpdates, 1000);
    }

    function invalidatePortfolio(includeHistory: boolean) {
      if (!userId) return;
      const keys = ["portfolio", "portfolio-positions", "portfolio-pnl"];
      if (includeHistory) keys.push("portfolio-trades", "portfolio-balance-history", "my-orders");
      for (const key of keys) invalidate(accountKey(userId, key));
    }

    function updateMarketSubscriptions() {
      if (socket?.readyState !== WebSocket.OPEN) return;
      for (const marketId of activeMarkets) {
        if (desiredMarkets.current.has(marketId)) continue;
        socket.send(JSON.stringify({ type: "unsubscribe_market", marketId }));
        activeMarkets.delete(marketId);
        subscribedMarkets.delete(marketId);
      }
      for (const marketId of desiredMarkets.current) {
        if (activeMarkets.has(marketId)) continue;
        socket.send(JSON.stringify({ type: "subscribe_market", marketId }));
        activeMarkets.add(marketId);
      }
      setLive(activeMarkets.size > 0 && activeMarkets.size === subscribedMarkets.size);
    }

    function scheduleReconnect() {
      if (disposed) return;
      setLive(false);
      const delay = Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
      reconnectTimer = window.setTimeout(connect, delay);
    }

    function connect() {
      if (disposed) return;
      try {
        socket = new WebSocket(WS_BASE_URL);
      } catch {
        scheduleReconnect();
        return;
      }
      const current = socket;
      activeMarkets.clear();
      subscribedMarkets.clear();
      let portfolioRequested = false;
      current.onopen = () => {
        if (disposed) return;
        attempts = 0;
        const token = userId ? getAccessToken() : null;
        if (token) current.send(JSON.stringify({ type: "auth", token }));
        updateMarketSubscriptions();
      };
      current.onmessage = ({ data }) => {
        if (disposed || typeof data !== "string") return;
        let message: unknown;
        try {
          message = JSON.parse(data);
        } catch {
          return;
        }
        if (!isRecord(message) || !isRecord(message.payload)) return;
        const { type, payload } = message;

        if (type === "subscribed") {
          if (userId && payload.userId === userId && !portfolioRequested) {
            portfolioRequested = true;
            current.send(JSON.stringify({ type: "subscribe_portfolio" }));
            invalidatePortfolio(true);
          }
          if (typeof payload.marketId === "string" && activeMarkets.has(payload.marketId)) {
            subscribedMarkets.add(payload.marketId);
            setLive(activeMarkets.size === subscribedMarkets.size);
            for (const key of ["market", "market-stats", "market-price-line", "order-book"]) {
              invalidate([key, payload.marketId]);
            }
          }
          return;
        }

        if (type === "portfolio_update" || type === "order_filled") invalidatePortfolio(true);
        if (type !== "price_update" && type !== "trade" && type !== "order_filled") return;

        const marketId = payload.marketId ?? (isRecord(payload.order) ? payload.order.marketId : undefined);
        if (typeof marketId !== "string" || !desiredMarkets.current.has(marketId)) return;
        invalidatePortfolio(false);
        for (const key of ["market", "market-stats", "market-price-line", "order-book"]) invalidate([key, marketId]);
      };
      current.onclose = scheduleReconnect;
    }

    syncMarkets.current = updateMarketSubscriptions;
    connect();

    return () => {
      disposed = true;
      syncMarkets.current = null;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(updateTimer);
      socket?.close();
    };
  }, [enabled, queryClient, user]);

  return live;
}
