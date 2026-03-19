import { Router, Request, Response } from 'express';
import { MarketsService } from './markets.service';
import { authenticate, requireRole } from '../../common/guards';

const router = Router();
const marketsService = new MarketsService();

// GET /api/v1/markets
router.get('/', async (req: Request, res: Response) => {
  const result = await marketsService.list(req.query as any);
  res.json({ success: true, data: result });
});

// GET /api/v1/markets/:id
router.get('/:id', async (req: Request, res: Response) => {
  const market = await marketsService.findById(req.params.id);
  res.json({ success: true, data: market });
});

// POST /api/v1/markets
router.post('/', authenticate(), async (req: Request, res: Response) => {
  const market = await marketsService.create(req.user!.id, req.body);
  res.status(201).json({ success: true, data: market });
});

// PATCH /api/v1/markets/:id
router.patch('/:id', authenticate(), async (req: Request, res: Response) => {
  const market = await marketsService.update(req.params.id, req.user!.id, req.body);
  res.json({ success: true, data: market });
});

// GET /api/v1/markets/:id/stats
router.get('/:id/stats', async (req: Request, res: Response) => {
  const stats = await marketsService.getStats(req.params.id);
  res.json({ success: true, data: stats });
});

// PATCH /api/v1/markets/:id/status (moderator+)
router.patch(
  '/:id/status',
  authenticate(),
  requireRole('moderator', 'admin'),
  async (req: Request, res: Response) => {
    const { status } = req.body;
    const market = await marketsService.updateStatus(req.params.id, status, req.user!.id);
    res.json({ success: true, data: market });
  }
);

export { router as marketsRouter };
