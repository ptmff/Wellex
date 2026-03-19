import { Router, Request, Response } from 'express';
import { ActivityService } from './activity.service';
import { authenticate } from '../../common/guards';

const router = Router();
const activityService = new ActivityService();

// GET /api/v1/activity (global feed)
router.get('/', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const before = req.query.before ? new Date(String(req.query.before)) : undefined;
  const data = await activityService.getGlobalFeed(limit, before);
  res.json({ success: true, data });
});

// GET /api/v1/activity/markets/:id
router.get('/markets/:id', async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const data = await activityService.getMarketFeed(req.params.id, limit);
  res.json({ success: true, data });
});

// GET /api/v1/activity/me (requires auth)
router.get('/me', authenticate(), async (req: Request, res: Response) => {
  const limit = Math.min(Number(req.query.limit ?? 50), 100);
  const data = await activityService.getUserFeed(req.user!.id, limit);
  res.json({ success: true, data });
});

export { router as activityRouter };
