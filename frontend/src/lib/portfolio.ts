export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type PortfolioBalanceSummary = {
  available: number;
  reserved: number;
  total: number;
  currency: string;
};

export type PortfolioPnlSummary = {
  pnl: {
    realized: number;
    unrealized: number;
    total: number;
  };
  positions: {
    count: number;
    open: number;
    totalInvested: number;
  };
  recentTrades?: Array<{
    id: string;
    marketId: string;
    side: "yes" | "no";
    price: number;
    quantity: number;
    totalValue: number;
    executedAt: string;
  }>;
};

export type PortfolioSummaryResponse = {
  balance: PortfolioBalanceSummary;
  pnl: PortfolioPnlSummary["pnl"];
  positions: PortfolioPnlSummary["positions"];
  recentTrades: NonNullable<PortfolioPnlSummary["recentTrades"]>;
};

export type PortfolioPosition = {
  id: string;
  marketId: string;
  marketTitle: string;
  marketStatus: string;
  marketOutcome: unknown;
  side: "yes" | "no";
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  currentValue: number;
  totalInvested: number;
  realizedPnl: number;
  unrealizedPnl: number;
  unrealizedPnlPct: number;
  tradeCount: number;
  closesAt: unknown;
  lastTradeAt: unknown;
};

export type PortfolioTrade = {
  id: string;
  marketId: string;
  marketTitle: string;
  marketStatus: string;
  side: "yes" | "no";
  tradeType: string;
  price: number;
  quantity: number;
  totalValue: number;
  fee: number;
  priceImpact: number;
  yesPriceBefore: number;
  yesPriceAfter: number;
  executedAt: string;
};

export type PortfolioBalanceTx = {
  id: string;
  type:
    | "deposit"
    | "withdrawal"
    | "trade_debit"
    | "trade_credit"
    | "fee"
    | "adjustment"
    | "refund";
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  description: string;
  referenceType: string;
  referenceId: string | null;
  createdAt: string;
};

export type PortfolioPnlEndpointResponse = {
  trading: {
    tradeCount: number;
    totalTraded: number;
    totalFees: number;
    avgTradeSize: number;
    yesVolume: number;
    noVolume: number;
  };
  pnl: {
    realizedFromTrades: number;
    resolutionPayouts: number;
    totalRealized: number;
  };
};

