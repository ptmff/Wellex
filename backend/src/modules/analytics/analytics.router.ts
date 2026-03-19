import { Router, Request, Response } from 'express';
import { AnalyticsService } from './analytics.service';

const router = Router();
const analyticsService = new AnalyticsService();

// GET /api/v1/analytics/markets/:id/candles
router.get('/markets/:id/candles', async (req: Request, res: Response) => {
  const candles = await analyticsService.getCandles(req.params.id, req.query as any);
  res.json({ success: true, data: candles });
});

// GET /api/v1/analytics/markets/:id/price-line
router.get('/markets/:id/price-line', async (req: Request, res: Response) => {
  const from = req.query.from ? new Date(Number(req.query.from) * 1000) : undefined;
  const to = req.query.to ? new Date(Number(req.query.to) * 1000) : undefined;
  const points = Math.min(Number(req.query.points ?? 200), 1000);

  const data = await analyticsService.getPriceLine(req.params.id, from, to, points);
  res.json({ success: true, data });
});

// GET /api/v1/analytics/markets/:id/volume
router.get('/markets/:id/volume', async (req: Request, res: Response) => {
  const data = await analyticsService.getVolumeHistory(
    req.params.id,
    (req.query.resolution as any) ?? '1d',
    Math.min(Number(req.query.limit ?? 30), 365)
  );
  res.json({ success: true, data });
});

// GET /api/v1/analytics/platform
router.get('/platform', async (_req: Request, res: Response) => {
  const metrics = await analyticsService.getPlatformMetrics();
  res.json({ success: true, data: metrics });
});

export { router as analyticsRouter };
