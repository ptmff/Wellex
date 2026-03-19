export type BackendMarketCategory = {
  // В текущей реализации бекенда в ответе может не быть `id` (не выбирают c.id в SELECT).
  // Поэтому делаем опциональным и для фильтрации/ключей используем `slug`.
  id?: string;
  name: string;
  slug?: string;
};

export type BackendMarketCreator = {
  username: string;
  displayName: string | null;
};

export type BackendMarketPrices = {
  yes: number; // 0..1
  no: number; // 0..1
};

export type BackendMarketStats = {
  volume24h: number;
  volumeTotal: number;
  tradeCount: number;
  liquidityTotal: number;
};

export type BackendMarket = {
  id: string;
  title: string;
  description: string;
  resolutionCriteria: string;
  imageUrl: string | null;
  status: "pending" | "active" | "paused" | "resolved" | "cancelled" | "expired";
  outcome: unknown; // depends on backend; keep flexible for now
  category: BackendMarketCategory | null;
  creator: BackendMarketCreator | null;
  prices: BackendMarketPrices;
  stats: BackendMarketStats;
  closesAt: any; // ISO (по факту может приходить нестрокой из-за сериализации)
  resolvedAt: any; // ISO
  resolutionNote: any;
  isFeatured: boolean;
  tags: string[];
  createdAt: any; // ISO
  updatedAt: any; // ISO
};

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export type MarketListResponse = PaginatedResult<BackendMarket>;

export type CreateMarketInput = {
  title: string;
  description: string;
  resolutionCriteria: string;
  categoryId?: string;
  closesAt: string; // datetime string
  initialLiquidity: number;
  imageUrl?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

export type UpdateMarketInput = {
  title?: string;
  description?: string;
  resolutionCriteria?: string;
  imageUrl?: string;
  tags?: string[];
};

export type UpdateMarketStatusInput = {
  status: "active" | "paused" | "cancelled";
};

export type ListMarketsInput = {
  page?: number;
  limit?: number;
  status?: BackendMarket["status"];
  categoryId?: string;
  search?: string;
  sortBy?: "created_at" | "closes_at" | "volume_24h" | "volume_total" | "trade_count";
  sortOrder?: "asc" | "desc";
  featured?: boolean;
  tag?: string;
};

export type MarketRecentTrade = {
  id: string;
  side: "yes" | "no" | string;
  price: number;
  quantity: number;
  totalValue: number;
  executedAt: string; // ISO
};

export type MarketStats = {
  marketId: string;
  volume24h: number;
  volumeTotal: number;
  tradeCount: number;
  uniqueTraders: number;
  currentYesPrice: number; // 0..1
  currentNoPrice: number; // 0..1
  liquidityTotal: number;
  recentTrades: MarketRecentTrade[];
};

export type PriceLinePoint = { time: number; yesPrice: number; noPrice: number }; // unix seconds, yes/no 0..1

export type AuthRequest = <T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    authRequired?: boolean;
    skipRefresh?: boolean;
  },
) => Promise<T>;

function buildQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    usp.set(key, String(value));
  }
  const qs = usp.toString();
  return qs ? `?${qs}` : "";
}

export async function listMarkets(request: AuthRequest, input: ListMarketsInput = {}) {
  const qs = buildQuery({
    page: input.page,
    limit: input.limit,
    status: input.status,
    categoryId: input.categoryId,
    search: input.search,
    sortBy: input.sortBy,
    sortOrder: input.sortOrder,
    featured: input.featured,
    tag: input.tag,
  });

  return request<MarketListResponse>(`/markets${qs}`, { method: "GET" });
}

export async function getMarket(request: AuthRequest, marketId: string) {
  return request<BackendMarket>(`/markets/${marketId}`, { method: "GET" });
}

export async function createMarket(request: AuthRequest, input: CreateMarketInput) {
  return request<BackendMarket>(`/markets`, { method: "POST", body: input, authRequired: true });
}

export async function updateMarket(request: AuthRequest, marketId: string, input: UpdateMarketInput) {
  return request<BackendMarket>(`/markets/${marketId}`, { method: "PATCH", body: input, authRequired: true });
}

export async function updateMarketStatus(request: AuthRequest, marketId: string, input: UpdateMarketStatusInput) {
  return request<BackendMarket>(`/markets/${marketId}/status`, { method: "PATCH", body: input, authRequired: true });
}

export async function getMarketStats(request: AuthRequest, marketId: string) {
  return request<MarketStats>(`/markets/${marketId}/stats`, { method: "GET" });
}

export async function getMarketPriceLine(
  request: AuthRequest,
  marketId: string,
  opts: { from?: number; to?: number; points?: number } = {},
) {
  const qs = buildQuery({
    from: opts.from,
    to: opts.to,
    points: opts.points,
  });
  return request<PriceLinePoint[]>(`/analytics/markets/${marketId}/price-line${qs}`, { method: "GET", authRequired: false });
}

