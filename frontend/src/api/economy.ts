import type { AuthRequest } from "./markets";

export type CoinPackage = {
  id: string;
  slug: string;
  name: string;
  wxAmount: number;
  priceRub: number;
  currency: string;
};

export type EconomyStatus = {
  currency: string;
  available: number;
  reserved: number;
  total: number;
  paymentProvider: "mock" | "yookassa" | string;
  ad: {
    canWatch: boolean;
    adsToday: number;
    maxPerDay: number;
    rewardAmount: number;
    nextAt: string | null;
    reason: string | null;
    reasonCode: "daily_limit" | "cooldown" | null;
    provider: "mock" | "yandex" | string;
    minWatchSeconds: number;
  };
  daily: {
    canClaim: boolean;
    amount: number;
    streak: number;
    claimedOn: string | null;
  };
};

export type AdSession = {
  sessionId: string;
  provider: "mock" | "yandex" | string;
  blockId: string | null;
  rewardAmount: number;
  minWatchSeconds: number;
  expiresInSeconds: number;
};

export type PurchaseResult = {
  purchaseId: string;
  wxAmount: number;
  currency: string;
  provider: string;
  status: "pending" | "succeeded" | "failed" | string;
  confirmationUrl?: string | null;
};

export type AdRewardResult = {
  wxAmount: number;
  currency: string;
  available: number;
  nextAt: string;
};

export async function listPackages(request: AuthRequest) {
  return request<CoinPackage[]>("/economy/packages", { method: "GET", authRequired: false });
}

export async function getEconomyStatus(request: AuthRequest) {
  return request<EconomyStatus>("/economy/me", { method: "GET", authRequired: true });
}

export async function purchasePackage(request: AuthRequest, packageSlug: string) {
  return request<PurchaseResult>("/economy/purchase", {
    method: "POST",
    body: { packageSlug },
    authRequired: true,
  });
}

export async function getPurchase(request: AuthRequest, purchaseId: string) {
  return request<PurchaseResult>(`/economy/purchases/${purchaseId}`, {
    method: "GET",
    authRequired: true,
  });
}

export async function startAdSession(request: AuthRequest) {
  return request<AdSession>("/economy/ads/session", { method: "POST", authRequired: true });
}

export async function claimAdReward(request: AuthRequest, sessionId: string) {
  return request<AdRewardResult>("/economy/ad-reward", {
    method: "POST",
    body: { sessionId },
    authRequired: true,
  });
}

export async function claimDailyBonus(request: AuthRequest) {
  return request<{ wxAmount: number; currency: string; available: number; streak: number }>(
    "/economy/daily-bonus",
    { method: "POST", authRequired: true },
  );
}
