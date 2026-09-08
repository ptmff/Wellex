import { config } from '../../config';
import { logger } from '../../common/logger';

export type GammaMarket = {
  id: string;
  question?: string;
  description?: string;
  resolutionSource?: string;
  image?: string | null;
  icon?: string | null;
  endDate?: string | null;
  closed?: boolean;
  active?: boolean;
  archived?: boolean;
  outcomes?: string;
  outcomePrices?: string;
  volume24hr?: number;
  groupItemTitle?: string | null;
  slug?: string;
  umaResolutionStatus?: string;
  winner?: string;
  outcome?: string;
  events?: Array<{ id?: string; title?: string; slug?: string }>;
};

export type GammaEvent = {
  id: string;
  title?: string;
  description?: string;
  slug?: string;
  image?: string | null;
  icon?: string | null;
  endDate?: string | null;
  closed?: boolean;
  active?: boolean;
  volume24hr?: number;
  tags?: Array<{ slug?: string; label?: string }>;
  markets?: GammaMarket[];
};

function parseJsonArray(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function parseOutcomes(market: GammaMarket): string[] {
  return parseJsonArray(market.outcomes);
}

export function parseOutcomePrices(market: GammaMarket): number[] {
  return parseJsonArray(market.outcomePrices).map((v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0.5;
  });
}

export function isBinaryYesNo(market: GammaMarket): boolean {
  const outcomes = parseOutcomes(market).map((o) => o.trim().toLowerCase());
  if (outcomes.length !== 2) return false;
  const set = new Set(outcomes);
  return set.has('yes') && set.has('no');
}

export function impliedYesPrice(market: GammaMarket): number {
  const outcomes = parseOutcomes(market).map((o) => o.trim().toLowerCase());
  const prices = parseOutcomePrices(market);
  const yesIdx = outcomes.findIndex((o) => o === 'yes');
  const raw = yesIdx >= 0 ? prices[yesIdx] : prices[0];
  if (!Number.isFinite(raw)) return 0.5;
  return Math.min(0.99, Math.max(0.01, raw));
}

export function resolvedOutcome(market: GammaMarket): 'yes' | 'no' | null {
  const winnerRaw = String(market.winner ?? market.outcome ?? '').trim().toLowerCase();
  if (winnerRaw === 'yes') return 'yes';
  if (winnerRaw === 'no') return 'no';

  if (!market.closed) return null;
  const outcomes = parseOutcomes(market).map((o) => o.trim().toLowerCase());
  const prices = parseOutcomePrices(market);
  if (outcomes.length !== 2 || prices.length !== 2) return null;
  const yesIdx = outcomes.findIndex((o) => o === 'yes');
  const noIdx = outcomes.findIndex((o) => o === 'no');
  if (yesIdx < 0 || noIdx < 0) return null;
  if (prices[yesIdx] >= 0.95 && prices[noIdx] <= 0.05) return 'yes';
  if (prices[noIdx] >= 0.95 && prices[yesIdx] <= 0.05) return 'no';
  return null;
}

async function gammaGet<T>(path: string, params: Record<string, string | number | boolean | string[]>): Promise<T> {
  const url = new URL(path, config.POLYMARKET_GAMMA_URL);
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Gamma API ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export class PolymarketClient {
  async listActiveEvents(limit: number): Promise<GammaEvent[]> {
    const events = await gammaGet<GammaEvent[]>('/events', {
      active: true,
      closed: false,
      limit,
      order: 'volume24hr',
      ascending: false,
    });
    logger.info('Fetched Polymarket events', { count: events.length });
    return Array.isArray(events) ? events : [];
  }

  async getMarketsByIds(ids: string[]): Promise<GammaMarket[]> {
    if (ids.length === 0) return [];
    const unique = [...new Set(ids)];
    const out: GammaMarket[] = [];
    for (let i = 0; i < unique.length; i += 50) {
      const slice = unique.slice(i, i + 50);
      const markets = await gammaGet<GammaMarket[]>('/markets', {
        id: slice,
        limit: slice.length,
      });
      if (Array.isArray(markets)) out.push(...markets);
    }
    return out;
  }
}
