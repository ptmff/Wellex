import { Router, Request, Response } from 'express';
import { EconomyService } from './economy.service';
import { authenticate } from '../../common/guards';

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

router.post('/purchase', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.purchase(req.user!.id, req.body);
  res.status(201).json({ success: true, data: result });
});

router.post('/ad-reward', authenticate(), async (req: Request, res: Response) => {
  const result = await economyService.claimAdReward(req.user!.id);
  res.json({ success: true, data: result });
});

export { router as economyRouter };
