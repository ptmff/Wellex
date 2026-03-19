import type { AuthRequest } from "./markets";

export type TradeSide = "yes" | "no";
export type TradeAction = "buy" | "sell";

export type TradeQuoteInput = {
  side: TradeSide;
  action: TradeAction;
  amount: number; // USD for buy, shares for sell
};

export type TradeQuoteResponse = {
  shares: number;
  totalCost: number; // USD spent (buy) or received (sell)
  averagePrice: number; // 0..1
  priceImpact: number; // %
  fee: number;
  priceAfter: number; // 0..1 for selected side
};

export type TradeExecuteInput = {
  side: TradeSide;
  action: TradeAction;
  amount: number; // USD for buy, shares for sell
  maxSlippage?: number; // % (0..50)
  expectedPrice?: number; // 0..1, optional slippage guard
};

export type TradeExecuteResponse = {
  tradeId: string;
  sharesTransacted: number;
  totalCost: number;
  averagePrice: number;
  priceImpact: number;
  yesPriceBefore: number;
  yesPriceAfter: number;
  fee: number;
  newBalance: number;
};

export async function getTradeQuote(
  request: AuthRequest,
  marketId: string,
  input: TradeQuoteInput,
) {
  return request<TradeQuoteResponse>(`/trading/${marketId}/quote`, {
    method: "POST",
    body: input,
    authRequired: false,
  });
}

export async function executeTrade(
  request: AuthRequest,
  marketId: string,
  input: TradeExecuteInput,
) {
  return request<TradeExecuteResponse>(`/trading/${marketId}/trade`, {
    method: "POST",
    body: input,
    authRequired: true,
  });
}

