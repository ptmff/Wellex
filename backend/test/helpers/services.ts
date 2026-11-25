import { WebSocketService } from '../../src/infrastructure/websocket/ws.service';
import { ActivityService } from '../../src/modules/activity/activity.service';
import { OrderBookService } from '../../src/modules/orders/orderbook.service';

/** OrderBookService wired with real Activity service and a WS service that is not attached to any HTTP server. */
export function makeOrderBook() {
  const ws = new WebSocketService();
  const broadcast = jest.spyOn(ws, 'broadcastToMarket').mockResolvedValue(undefined);
  const notifications = { notifyFill: jest.fn().mockResolvedValue(undefined), notifyResolved: jest.fn().mockResolvedValue(undefined) };
  const service = new OrderBookService(ws, new ActivityService(), notifications);
  return { service, ws, broadcast, notifications };
}
