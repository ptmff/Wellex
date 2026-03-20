import { useEffect, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { WS_BASE_URL } from "@/config";
import { getAccessToken } from "@/auth/session";

type WsInboundMessage = {
  type: string;
  payload: unknown;
  timestamp: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
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

  const marketIdSetRef = useRef<Set<string>>(new Set());
  const subscribedMarketIdsRef = useRef<Set<string>>(new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const authedRef = useRef(false);

  const lastInvalidateAtRef = useRef(0);
  const scheduledInvalidateRef = useRef<number | null>(null);

  const marketIdKey = useMemo(() => marketIds.slice().sort().join(","), [marketIds]);

  // Keep "marketIds" fresh without recreating the WS connection.
  useEffect(() => {
    marketIdSetRef.current = new Set(marketIds);
  }, [marketIdKey, marketIds]);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let reconnectAttempts = 0;

    const invalidateAll = () => {
      const now = Date.now();
      const throttleMs = 1500;

      const shouldInvalidate = now - lastInvalidateAtRef.current >= throttleMs;
      if (!shouldInvalidate) {
        const remaining = throttleMs - (now - lastInvalidateAtRef.current);
        if (scheduledInvalidateRef.current) window.clearTimeout(scheduledInvalidateRef.current);
        scheduledInvalidateRef.current = window.setTimeout(() => {
          scheduledInvalidateRef.current = null;
          lastInvalidateAtRef.current = Date.now();
          queryClient.invalidateQueries({ queryKey: ["portfolio"] });
          queryClient.invalidateQueries({ queryKey: ["portfolio-positions"] });
          queryClient.invalidateQueries({ queryKey: ["portfolio-trades"] });
          queryClient.invalidateQueries({ queryKey: ["portfolio-balance-history"] });
          queryClient.invalidateQueries({ queryKey: ["portfolio-pnl"] });
        }, remaining);
        return;
      }

      lastInvalidateAtRef.current = now;
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-positions"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-trades"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-balance-history"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-pnl"] });
    };

    const invalidatePositionsOnly = () => {
      const now = Date.now();
      const throttleMs = 700;

      const shouldInvalidate = now - lastInvalidateAtRef.current >= throttleMs;
      if (!shouldInvalidate) {
        const remaining = throttleMs - (now - lastInvalidateAtRef.current);
        if (scheduledInvalidateRef.current) window.clearTimeout(scheduledInvalidateRef.current);
        scheduledInvalidateRef.current = window.setTimeout(() => {
          scheduledInvalidateRef.current = null;
          lastInvalidateAtRef.current = Date.now();
          queryClient.invalidateQueries({ queryKey: ["portfolio"] });
          queryClient.invalidateQueries({ queryKey: ["portfolio-positions"] });
          queryClient.invalidateQueries({ queryKey: ["portfolio-pnl"] });
        }, remaining);
        return;
      }

      lastInvalidateAtRef.current = now;
      queryClient.invalidateQueries({ queryKey: ["portfolio"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-positions"] });
      queryClient.invalidateQueries({ queryKey: ["portfolio-pnl"] });
    };

    const subscribeMissingMarkets = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!authedRef.current) {
        // Subscribe to markets even without auth (price_update/trade are broadcast to market subscribers).
        // Portfolio channel requires auth but positions can still update via market events.
      }

      for (const id of marketIdSetRef.current) {
        if (subscribedMarketIdsRef.current.has(id)) continue;
        ws.send(JSON.stringify({ type: "subscribe_market", marketId: id }));
        subscribedMarketIdsRef.current.add(id);
      }
    };

    const ensurePortfolioSubscriptions = () => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      // Subscribe to portfolio updates (if backend emits portfolio_update).
      ws.send(JSON.stringify({ type: "subscribe_portfolio" }));
      subscribeMissingMarkets();
    };

    const connect = () => {
      if (cancelled) return;

      reconnectAttempts += 1;
      const ws = new WebSocket(WS_BASE_URL);
      wsRef.current = ws;

      subscribedMarketIdsRef.current = new Set();
      authedRef.current = false;

      ws.onopen = () => {
        const token = getAccessToken();
        // Order matters: auth should be processed before subscribing_portfolio.
        if (token) ws.send(JSON.stringify({ type: "auth", token }));
        ws.send(JSON.stringify({ type: "subscribe_portfolio" }));
        subscribeMissingMarkets();
      };

      ws.onmessage = (evt) => {
        const raw = evt.data;
        let message: WsInboundMessage;
        try {
          message = JSON.parse(raw) as WsInboundMessage;
        } catch {
          return;
        }

        if (!message || typeof message.type !== "string") return;

        if (message.type === "portfolio_update") {
          invalidateAll();
          return;
        }

        if (message.type === "price_update" || message.type === "trade" || message.type === "order_filled") {
          const payload = message.payload;
          if (isObject(payload)) {
            const payloadAny = payload as Record<string, unknown>;
            const marketIdCandidate =
              (typeof payloadAny.marketId === "string" ? payloadAny.marketId : undefined) ??
              (typeof (payloadAny as any).order?.marketId === "string" ? (payloadAny as any).order.marketId : undefined);

            if (typeof marketIdCandidate === "string" && marketIdSetRef.current.has(marketIdCandidate)) {
              invalidatePositionsOnly();
            }
          }
          return;
        }

        if (message.type === "subscribed" || message.type === "unsubscribed") {
          const payload = message.payload;
          if (isObject(payload)) {
            if ("userId" in payload) authedRef.current = true;
            if ("channel" in payload && payload.channel === "portfolio") {
              // No-op. We keep subscribed state implicitly via invalidations.
            }
            if ("marketId" in payload && typeof payload.marketId === "string") {
              subscribedMarketIdsRef.current.add(payload.marketId);
            }
          }
          // If auth completed, make sure portfolio subscriptions are in place.
          if (authedRef.current) ensurePortfolioSubscriptions();
          return;
        }
      };

      ws.onerror = () => {
        // Network errors will likely trigger onclose; keep the handler minimal.
      };

      ws.onclose = () => {
        if (cancelled) return;
        if (reconnectAttempts >= 6) return;
        const delayMs = Math.min(10000, 500 * 2 ** reconnectAttempts);
        window.setTimeout(connect, delayMs);
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (scheduledInvalidateRef.current) window.clearTimeout(scheduledInvalidateRef.current);
      scheduledInvalidateRef.current = null;

      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        for (const id of subscribedMarketIdsRef.current) {
          ws.send(JSON.stringify({ type: "unsubscribe_market", marketId: id }));
        }
        ws.close(1000, "Client unmounted");
      } else {
        ws?.close();
      }
    };
  }, [enabled, queryClient]);
}

