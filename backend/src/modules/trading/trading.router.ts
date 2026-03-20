import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate } from '../../common/guards';
import { tradeCounter, tradeVolume } from '../../infrastructure/metrics/prometheus';
import { OrderBookService } from '../orders/orderbook.service';

const router = Router();

// Services are singletons injected at app level; here we access them via req.app.locals
function getOrderBookService(req: Request): OrderBookService {
  return req.app.locals.orderBookService as OrderBookService;
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
    const service = getOrderBookService(req);

    const result = await service.executeMarketTrade({
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
    const service = getOrderBookService(req);

    const quote = await service.getTradeQuote(
      req.params.marketId,
      validated.side,
      validated.action,
      validated.amount
    );

    res.json({ success: true, data: quote });
  }
);

export { router as tradingRouter };
