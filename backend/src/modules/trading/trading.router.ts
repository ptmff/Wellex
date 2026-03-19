import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { LMSREngine } from './lmsr.engine';
import { authenticate } from '../../common/guards';
import { WebSocketService } from '../../infrastructure/websocket/ws.service';
import { ActivityService } from '../activity/activity.service';
import { tradeCounter, tradeVolume } from '../../infrastructure/metrics/prometheus';

const router = Router();

// Services are singletons injected at app level; here we access them via req.app.locals
function getEngine(req: Request): LMSREngine {
  return req.app.locals.lmsrEngine as LMSREngine;
}

const TradeDto = z.object({
  side: z.enum(['yes', 'no']),
  action: z.enum(['buy', 'sell']),
  amount: z.number().positive(),
  maxSlippage: z.number().min(0).max(50).default(5),
  expectedPrice: z.number().min(0).max(1).optional(),
});

const QuoteDto = z.object({
  side: z.enum(['yes', 'no']),
  action: z.enum(['buy', 'sell']),
  amount: z.number().positive(),
});

// POST /api/v1/trading/:marketId/trade
router.post(
  '/:marketId/trade',
  authenticate(),
  async (req: Request, res: Response) => {
    const validated = TradeDto.parse(req.body);
    const engine = getEngine(req);

    const result = await engine.executeTrade({
      userId: req.user!.id,
      marketId: req.params.marketId,
      ...validated,
    });

    // Metrics
    tradeCounter.inc({ side: validated.side, action: validated.action });
    tradeVolume.inc(result.totalCost);

    res.status(201).json({ success: true, data: result });
  }
);

// POST /api/v1/trading/:marketId/quote
router.post(
  '/:marketId/quote',
  async (req: Request, res: Response) => {
    const validated = QuoteDto.parse(req.body);
    const engine = getEngine(req);

    const quote = await engine.getQuote(
      req.params.marketId,
      validated.side,
      validated.action,
      validated.amount
    );

    res.json({ success: true, data: quote });
  }
);

export { router as tradingRouter };
