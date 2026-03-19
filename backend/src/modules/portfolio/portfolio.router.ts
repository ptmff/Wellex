import { Router, Request, Response } from 'express';
import { PortfolioService } from './portfolio.service';
import { authenticate } from '../../common/guards';

const router = Router();
const portfolioService = new PortfolioService();

// All portfolio routes require auth
router.use(authenticate());

// GET /api/v1/portfolio
router.get('/', async (req: Request, res: Response) => {
  const portfolio = await portfolioService.getPortfolio(req.user!.id);
  res.json({ success: true, data: portfolio });
});

// GET /api/v1/portfolio/positions
router.get('/positions', async (req: Request, res: Response) => {
  const positions = await portfolioService.getPositions(req.user!.id);
  res.json({ success: true, data: positions });
});

// GET /api/v1/portfolio/trades
router.get('/trades', async (req: Request, res: Response) => {
  const result = await portfolioService.getTradeHistory(req.user!.id, {
    page: Number(req.query.page) || 1,
    limit: Number(req.query.limit) || 20,
    marketId: req.query.marketId as string | undefined,
  });
  res.json({ success: true, data: result });
});

// GET /api/v1/portfolio/balance-history
router.get('/balance-history', async (req: Request, res: Response) => {
  const result = await portfolioService.getBalanceHistory(req.user!.id, req.query as any);
  res.json({ success: true, data: result });
});

// GET /api/v1/portfolio/pnl
router.get('/pnl', async (req: Request, res: Response) => {
  const summary = await portfolioService.getPnlSummary(req.user!.id);
  res.json({ success: true, data: summary });
});

export { router as portfolioRouter };
