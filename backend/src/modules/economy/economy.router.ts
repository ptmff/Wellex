import { Router, Request, Response, NextFunction } from 'express';
import { EconomyService } from './economy.service';
import { authenticate } from '../../common/guards';
import { logger } from '../../common/logger';
import { config } from '../../config';

const router = Router();
const economyService = new EconomyService();

// Official YooKassa notification source ranges:
// https://yookassa.ru/developers/using-api/webhooks#ip
const YOOKASSA_IPV4_RANGES: Array<[number, number]> = [
  ipv4Range('185.71.76.0', 27),
  ipv4Range('185.71.77.0', 27),
  ipv4Range('77.75.153.0', 25),
  ipv4Range('77.75.156.11', 32),
  ipv4Range('77.75.156.35', 32),
  ipv4Range('77.75.154.128', 25),
];
const YOOKASSA_IPV6_PREFIX = '2a02:5180:'; // 2a02:5180::/32

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

function ipv4Range(base: string, maskBits: number): [number, number] {
  const start = ipv4ToInt(base)!;
  const size = 2 ** (32 - maskBits);
  return [start, start + size - 1];
}

function isYooKassaIp(rawIp: string | undefined): boolean {
  if (!rawIp) return false;
  const ip = rawIp.startsWith('::ffff:') ? rawIp.slice(7) : rawIp;

  const asInt = ipv4ToInt(ip);
  if (asInt !== null) {
    return YOOKASSA_IPV4_RANGES.some(([start, end]) => asInt >= start && asInt <= end);
  }
  return ip.toLowerCase().startsWith(YOOKASSA_IPV6_PREFIX);
}

// Defense in depth: YooKassa notifications are not HMAC-signed.
// Official verification is (1) source IP allowlist in production and
// (2) re-fetching payment status from the YooKassa API (never trust the body).
function yookassaIpFilter(req: Request, res: Response, next: NextFunction): void {
  if (config.NODE_ENV !== 'production' || config.PAYMENT_PROVIDER !== 'yookassa') {
    next();
    return;
  }
  if (!isYooKassaIp(req.ip)) {
    logger.warn('YooKassa webhook rejected: source IP is not in allowlist', { ip: req.ip });
    res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Forbidden' } });
    return;
  }
  next();
}

router.get('/packages', async (_req: Request, res: Response) => {
  const packages = await economyService.listPackages();
  res.json({ success: true, data: packages });
});

router.get('/me', authenticate(), async (req: Request, res: Response) => {
  const status = await economyService.getStatus(req.user!.id);
  res.json({ success: true, data: status });
});

router.get('/purchases/:id', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.getPurchase(req.user!.id, req.params.id);
  res.json({ success: true, data: result });
});

router.post('/purchase', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.purchase(req.user!.id, req.body);
  const status = result.status === 'succeeded' ? 201 : 202;
  res.status(status).json({ success: true, data: result });
});

router.post('/webhooks/yookassa', yookassaIpFilter, async (req: Request, res: Response) => {
  try {
    const result = await economyService.handleYooKassaWebhook(req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    logger.error('YooKassa webhook rejected', { error: (err as Error).message });
    res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: (err as Error).message,
        timestamp: new Date().toISOString(),
      },
    });
  }
});

router.post('/ads/session', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.startAdSession(req.user!.id);
  res.status(201).json({ success: true, data: result });
});

router.post('/ad-reward', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.claimAdReward(req.user!.id, req.body);
  res.json({ success: true, data: result });
});

router.post('/daily-bonus', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.claimDailyBonus(req.user!.id);
  res.json({ success: true, data: result });
});

export { router as economyRouter };
