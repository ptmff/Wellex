import type { AuthRequest } from "./markets";

export type OrderSide = "yes" | "no";
export type OrderAction = "buy" | "sell";

export type PlaceOrderInput = {
  side: OrderSide;
  action: OrderAction;
  price: number; // 0..1
  quantity: number; // shares
};

export type PlacedOrder = {
  id: string;
  marketId: string;
  side: OrderSide;
  action: OrderAction;
  status: string;
  price: number;
  quantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  createdAt?: string;
};

export async function placeOrder(request: AuthRequest, marketId: string, input: PlaceOrderInput) {
  return request<PlacedOrder>(`/orders/${marketId}`, {
    method: "POST",
    body: input,
    authRequired: true,
  });
}

export type OrderBookLevel = {
  price: number;
  quantity: number;
  orderCount: number;
};

export type OrderBookSnapshot = {
  marketId: string;
  yesAsks: OrderBookLevel[];
  yesBids: OrderBookLevel[];
  noAsks: OrderBookLevel[];
  noBids: OrderBookLevel[];
  spread: { yes: number; no: number };
  midPrice: { yes: number; no: number };
  timestamp: string;
};

export async function getOrderBook(request: AuthRequest, marketId: string, depth = 10) {
  return request<OrderBookSnapshot>(`/orders/book/${marketId}?depth=${depth}`, {
    method: "GET",
    authRequired: false,
  });
}

export type PaginatedResult<T> = {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
};

export async function getMyOrders(
  request: AuthRequest,
  params: { marketId?: string; page?: number; limit?: number; status?: string } = {},
) {
  const qs = new URLSearchParams();
  if (params.marketId) qs.set("marketId", params.marketId);
  if (params.page) qs.set("page", String(params.page));
  if (params.limit) qs.set("limit", String(params.limit));
  if (params.status) qs.set("status", params.status);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  return request<PaginatedResult<PlacedOrder>>(`/orders${suffix}`, {
    method: "GET",
    authRequired: true,
  });
}

export async function cancelOrder(request: AuthRequest, orderId: string) {
  return request<{ message: string }>(`/orders/${orderId}`, {
    method: "DELETE",
    authRequired: true,
  });
}

