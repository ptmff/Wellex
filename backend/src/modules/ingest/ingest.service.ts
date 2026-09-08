import Decimal from 'decimal.js';
import { db } from '../../database/connection';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { marketCache } from '../../infrastructure/redis/cache.service';
import { OrderBookService } from '../orders/orderbook.service';
import { MarketMakerService } from '../bots/market-maker.service';
import {
  impliedYesPrice,
  isBinaryYesNo,
  PolymarketClient,
  resolvedOutcome,
  type GammaEvent,
  type GammaMarket,
} from './polymarket.client';

const TAG_TO_SLUG: Record<string, string> = {
  politics: 'politics',
  geopolitics: 'politics',
  elections: 'politics',
  crypto: 'crypto',
  bitcoin: 'crypto',
  sports: 'sports',
  nba: 'sports',
  nfl: 'sports',
  soccer: 'sports',
  finance: 'finance',
  economy: 'finance',
  business: 'finance',
  science: 'science',
  tech: 'technology',
  technology: 'technology',
  ai: 'technology',
  culture: 'entertainment',
  'pop-culture': 'entertainment',
  entertainment: 'entertainment',
};

function mapCategorySlug(tags: Array<{ slug?: string }> | undefined): string {
  for (const tag of tags ?? []) {
    const slug = (tag.slug ?? '').toLowerCase();
    if (TAG_TO_SLUG[slug]) return TAG_TO_SLUG[slug];
  }
  return 'world-events';
}

function asHttpUrl(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString();
  } catch {
    return undefined;
  }
  return undefined;
}

function padText(value: string, min: number, fallback: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= min) return trimmed;
  return `${trimmed} ${fallback}`.trim();
}

export class IngestService {
  constructor(
    private readonly client: PolymarketClient,
    private readonly marketMaker: MarketMakerService,
    private readonly orderBookService: OrderBookService
  ) {}

  async runDailySync(): Promise<{ imported: number; skipped: number; resolved: number; ordersPlaced: number }> {
    const ingestUser = await db('users').where('username', 'bot_ingest').first();
    if (!ingestUser) {
      logger.error('bot_ingest user is missing; cannot ingest markets');
      return { imported: 0, skipped: 0, resolved: 0, ordersPlaced: 0 };
    }

    const imported = await this.importActiveMarkets(ingestUser.id);
    const resolved = await this.syncResolutions(ingestUser.id);
    await marketCache.delPattern('list:*');

    return { ...imported, resolved };
  }

  private async importActiveMarkets(creatorId: string) {
    const events = await this.client.listActiveEvents(Math.max(config.POLYMARKET_INGEST_LIMIT, 20));
    const categories = await db('market_categories').select('id', 'slug');
    const categoryBySlug = Object.fromEntries(categories.map((c: { id: string; slug: string }) => [c.slug, c.id]));

    const candidates: Array<{ event: GammaEvent; market: GammaMarket; volume: number }> = [];
    for (const event of events) {
      for (const market of event.markets ?? []) {
        if (!market.id || !isBinaryYesNo(market) || market.closed || market.archived) continue;
        candidates.push({
          event,
          market,
          volume: Number(market.volume24hr ?? event.volume24hr ?? 0),
        });
      }
    }
    candidates.sort((a, b) => b.volume - a.volume);

    let imported = 0;
    let skipped = 0;
    let ordersPlaced = 0;

    for (const candidate of candidates.slice(0, config.POLYMARKET_INGEST_LIMIT)) {
      const result = await this.importOne(candidate.event, candidate.market, creatorId, categoryBySlug);
      if (result === 'imported') imported += 1;
      else skipped += 1;
    }

    // Seed books for newly imported markets that still have no orders.
    const fresh = await db('markets')
      .where({ external_source: 'polymarket', status: 'active' })
      .whereNotExists(function () {
        this.select(db.raw('1')).from('orders').whereRaw('orders.market_id = markets.id');
      })
      .select('id', 'current_yes_price')
      .limit(config.POLYMARKET_INGEST_LIMIT);

    for (const row of fresh) {
      ordersPlaced += await this.marketMaker.seedMarket(row.id, parseFloat(row.current_yes_price ?? '0.5'));
    }

    logger.info('Polymarket ingest finished', { imported, skipped, ordersPlaced });
    return { imported, skipped, ordersPlaced };
  }

  private async importOne(
    event: GammaEvent,
    market: GammaMarket,
    creatorId: string,
    categoryBySlug: Record<string, string>
  ): Promise<'imported' | 'exists' | 'skipped' | 'seeded'> {
    if (!market.id || !isBinaryYesNo(market) || market.closed || market.archived) {
      return 'skipped';
    }

    const existing = await db('markets')
      .where({ external_source: 'polymarket', external_id: String(market.id) })
      .first();
    if (existing) return 'exists';

    const closesAt = this.resolveClosesAt(market.endDate ?? event.endDate);
    if (!closesAt || closesAt.getTime() <= Date.now() + 60 * 60 * 1000) {
      return 'skipped';
    }

    const title = padText(market.question || event.title || `Polymarket ${market.id}`, 10, 'event');
    const description = padText(
      market.description || event.description || title,
      20,
      'Imported from Polymarket as a Wellex binary market.'
    );
    const resolutionCriteria = padText(
      market.resolutionSource ||
        `Resolves to the same outcome as Polymarket market ${market.id} (${event.slug ?? event.id}).`,
      20,
      'Official resolution follows Polymarket.'
    );

    const yesPrice = impliedYesPrice(market);
    const noPrice = clamp01(1 - yesPrice);
    const categoryId = categoryBySlug[mapCategorySlug(event.tags)] ?? categoryBySlug['world-events'] ?? null;
    const imageUrl = asHttpUrl(market.image || market.icon || event.image || event.icon) ?? null;

    try {
      const [created] = await db('markets')
        .insert({
          creator_id: creatorId,
          category_id: categoryId,
          title: title.slice(0, 500),
          description: description.slice(0, 5000),
          resolution_criteria: resolutionCriteria.slice(0, 2000),
          image_url: imageUrl,
          status: 'active',
          initial_liquidity: '0',
          liquidity_b: new Decimal(1).toFixed(8),
          yes_shares: '0',
          no_shares: '0',
          current_yes_price: yesPrice.toFixed(8),
          current_no_price: noPrice.toFixed(8),
          liquidity_total: '0',
          closes_at: closesAt,
          tags: JSON.stringify(['polymarket', ...(event.tags ?? []).map((t) => t.slug).filter(Boolean).slice(0, 8)]),
          metadata: JSON.stringify({
            polymarketEventId: event.id,
            polymarketSlug: event.slug,
            polymarketUrl: event.slug ? `https://polymarket.com/event/${event.slug}` : undefined,
          }),
          external_source: 'polymarket',
          external_id: String(market.id),
          is_featured: importedFeatured(event),
        })
        .returning('*');

      await db('price_history').insert({
        market_id: created.id,
        yes_price: yesPrice.toFixed(8),
        no_price: noPrice.toFixed(8),
        volume: '0',
        trade_count: 0,
      });

      return 'imported';
    } catch (err) {
      const message = (err as Error).message ?? '';
      if (message.includes('markets_external_uidx') || (err as { code?: string }).code === '23505') {
        return 'exists';
      }
      logger.warn('Failed to import Polymarket market', { marketId: market.id, error: message });
      return 'skipped';
    }
  }

  private resolveClosesAt(raw: string | null | undefined): Date | null {
    if (!raw) return null;
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return null;
    return date;
  }

  private async syncResolutions(resolvedBy: string): Promise<number> {
    const openExternal = await db('markets')
      .where('external_source', 'polymarket')
      .whereIn('status', ['active', 'paused', 'expired'])
      .select('id', 'external_id');

    if (openExternal.length === 0) return 0;

    const ids = openExternal.map((m: { external_id: string }) => m.external_id).filter(Boolean);
    const remote = await this.client.getMarketsByIds(ids);
    const byId = new Map(remote.map((m) => [String(m.id), m]));

    let resolved = 0;
    for (const local of openExternal) {
      const gamma = byId.get(String(local.external_id));
      if (!gamma) continue;
      const outcome = resolvedOutcome(gamma);
      if (!outcome) continue;
      try {
        await this.orderBookService.resolveMarket(
          local.id,
          outcome,
          resolvedBy,
          `Auto-resolved from Polymarket market ${gamma.id}`
        );
        await marketCache.del(`market:${local.id}`);
        resolved += 1;
      } catch (err) {
        logger.warn('Auto-resolve skipped', { marketId: local.id, error: (err as Error).message });
      }
    }

    return resolved;
  }
}

function clamp01(n: number): number {
  return Math.min(0.99, Math.max(0.01, n));
}

function importedFeatured(event: GammaEvent): boolean {
  return Number(event.volume24hr ?? 0) > 100_000;
}
