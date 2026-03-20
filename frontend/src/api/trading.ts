import type { AuthRequest } from "./markets";

export type MarketTradeInput = {
  side: "yes" | "no";
  action: "buy" | "sell";
  amount: number;
  maxSlippage?: number;
  expectedPrice?: number;
};

export type MarketTradeResult = {
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

export type MarketQuoteInput = {
  side: "yes" | "no";
  action: "buy" | "sell";
  amount: number;
};

export type MarketQuoteResult = {
  shares: number;
  totalCost: number;
  averagePrice: number;
  priceImpact: number;
  fee: number;
  priceAfter: number;
};

export async function getTradeQuote(request: AuthRequest, marketId: string, input: MarketQuoteInput) {
  return request<MarketQuoteResult>(`/trading/${marketId}/quote`, {
    method: "POST",
    body: input,
    authRequired: false,
  });
}

export async function executeMarketTrade(request: AuthRequest, marketId: string, input: MarketTradeInput) {
  return request<MarketTradeResult>(`/trading/${marketId}/trade`, {
    method: "POST",
    body: input,
    authRequired: true,
  });
}
