import { Router, Request, Response } from 'express';
import { OrderBookService } from './orderbook.service';
import { authenticate } from '../../common/guards';
import { WebSocketService } from '../../infrastructure/websocket/ws.service';
import { ActivityService } from '../activity/activity.service';

const router = Router();

function getService(req: Request): OrderBookService {
  return req.app.locals.orderBookService as OrderBookService;
}

// GET /api/v1/orders/book/:marketId
router.get('/book/:marketId', async (req: Request, res: Response) => {
  const depth = Math.min(parseInt(String(req.query.depth ?? 10)), 50);
  const service = getService(req);
  const book = await service.getOrderBook(req.params.marketId, depth);
  res.json({ success: true, data: book });
});

// GET /api/v1/orders (user's orders)
router.get('/', authenticate(), async (req: Request, res: Response) => {
  const service = getService(req);
  const result = await service.getUserOrders(req.user!.id, req.query as any);
  res.json({ success: true, data: result });
});

// GET /api/v1/orders/:id
router.get('/:id', authenticate(), async (req: Request, res: Response) => {
  const service = getService(req);
  const order = await service.getOrderById(req.params.id, req.user!.id);
  res.json({ success: true, data: order });
});

// POST /api/v1/orders/:marketId
router.post('/:marketId', authenticate(), async (req: Request, res: Response) => {
  const service = getService(req);
  const order = await service.placeOrder(req.user!.id, req.params.marketId, req.body);
  res.status(201).json({ success: true, data: order });
});

// DELETE /api/v1/orders/:id
router.delete('/:id', authenticate(), async (req: Request, res: Response) => {
  const service = getService(req);
  await service.cancelOrder(req.user!.id, req.params.id);
  res.json({ success: true, data: { message: 'Order cancelled' } });
});

export { router as ordersRouter };
