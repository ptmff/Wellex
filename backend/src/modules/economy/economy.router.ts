import { Router, Request, Response } from 'express';
import { EconomyService } from './economy.service';
import { authenticate } from '../../common/guards';
import { logger } from '../../common/logger';

const router = Router();
const economyService = new EconomyService();

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

router.post('/webhooks/yookassa', async (req: Request, res: Response) => {
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

router.post('/ad-reward', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.claimAdReward(req.user!.id);
  res.json({ success: true, data: result });
});

export { router as economyRouter };
