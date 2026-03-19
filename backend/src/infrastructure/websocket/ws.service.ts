import { WebSocketServer, WebSocket } from 'ws';
import { IncomingMessage, Server } from 'http';
import { redisClient } from '../redis/cache.service';
import { config } from '../../config';
import { logger } from '../../common/logger';
import { AuthService } from '../../modules/auth/auth.service';

export type WsEventType =
  | 'price_update'
  | 'trade'
  | 'market_resolved'
  | 'market_created'
  | 'order_filled'
  | 'portfolio_update'
  | 'heartbeat'
  | 'error'
  | 'subscribed'
  | 'unsubscribed';

export interface WsMessage {
  type: WsEventType;
  payload: unknown;
  timestamp: string;
}

interface ClientState {
  ws: WebSocket;
  userId?: string;
  subscribedMarkets: Set<string>;
  subscribedToPortfolio: boolean;
  isAlive: boolean;
}

export class WebSocketService {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ClientState> = new Map();
  private marketSubscribers: Map<string, Set<string>> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private readonly authService: AuthService;

  constructor() {
    this.authService = new AuthService();
  }

  initialize(server: Server): void {
    this.wss = new WebSocketServer({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      this.handleConnection(ws, req);
    });

    this.wss.on('error', (error) => {
      logger.error('WebSocket server error', { error: error.message });
    });

    // Heartbeat - detect stale connections
    this.heartbeatInterval = setInterval(() => {
      this.pingClients();
    }, config.WS_HEARTBEAT_INTERVAL);

    // Redis pub/sub for horizontal scaling
    this.setupRedisPubSub();

    logger.info('✅ WebSocket server initialized');
  }

  private handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const clientId = crypto.randomUUID();

    const clientState: ClientState = {
      ws,
      subscribedMarkets: new Set(),
      subscribedToPortfolio: false,
      isAlive: true,
    };

    this.clients.set(clientId, clientState);

    logger.debug('WebSocket client connected', { clientId });

    ws.on('message', (data) => this.handleMessage(clientId, data.toString()));
    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) client.isAlive = true;
    });
    ws.on('close', () => this.handleDisconnect(clientId));
    ws.on('error', (error) => {
      logger.warn('WebSocket client error', { clientId, error: error.message });
    });

    // Send welcome
    this.sendToClient(clientId, 'heartbeat', { clientId });
  }

  private async handleMessage(clientId: string, rawData: string): Promise<void> {
    const client = this.clients.get(clientId);
    if (!client) return;

    let message: any;
    try {
      message = JSON.parse(rawData);
    } catch {
      this.sendToClient(clientId, 'error', { message: 'Invalid JSON' });
      return;
    }

    switch (message.type) {
      case 'auth': {
        if (message.token) {
          try {
            const payload = this.authService.verifyAccessToken(message.token);
            client.userId = payload.sub;
            this.sendToClient(clientId, 'subscribed', { userId: client.userId });
          } catch {
            this.sendToClient(clientId, 'error', { message: 'Invalid token' });
          }
        }
        break;
      }

      case 'subscribe_market': {
        const marketId = message.marketId;
        if (typeof marketId !== 'string') {
          this.sendToClient(clientId, 'error', { message: 'Invalid marketId' });
          return;
        }

        client.subscribedMarkets.add(marketId);

        if (!this.marketSubscribers.has(marketId)) {
          this.marketSubscribers.set(marketId, new Set());
        }
        this.marketSubscribers.get(marketId)!.add(clientId);

        this.sendToClient(clientId, 'subscribed', { marketId });
        break;
      }

      case 'unsubscribe_market': {
        const marketId = message.marketId;
        client.subscribedMarkets.delete(marketId);
        this.marketSubscribers.get(marketId)?.delete(clientId);
        this.sendToClient(clientId, 'unsubscribed', { marketId });
        break;
      }

      case 'subscribe_portfolio': {
        if (!client.userId) {
          this.sendToClient(clientId, 'error', { message: 'Authentication required' });
          return;
        }
        client.subscribedToPortfolio = true;
        this.sendToClient(clientId, 'subscribed', { channel: 'portfolio' });
        break;
      }

      case 'ping': {
        this.sendToClient(clientId, 'heartbeat', { ts: Date.now() });
        break;
      }
    }
  }

  private handleDisconnect(clientId: string): void {
    const client = this.clients.get(clientId);
    if (!client) return;

    // Clean up market subscriptions
    for (const marketId of client.subscribedMarkets) {
      this.marketSubscribers.get(marketId)?.delete(clientId);
    }

    this.clients.delete(clientId);
    logger.debug('WebSocket client disconnected', { clientId });
  }

  private pingClients(): void {
    for (const [clientId, client] of this.clients.entries()) {
      if (!client.isAlive) {
        client.ws.terminate();
        this.handleDisconnect(clientId);
        continue;
      }
      client.isAlive = false;
      client.ws.ping();
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // BROADCASTING
  // ─────────────────────────────────────────────────────────────────

  async broadcastToMarket(marketId: string, type: WsEventType, payload: unknown): Promise<void> {
    // Publish to Redis for horizontal scaling
    await redisClient.publish(
      `market:${marketId}`,
      JSON.stringify({ type, payload, timestamp: new Date().toISOString() })
    );

    // Also send directly (same instance)
    this.sendToMarketSubscribers(marketId, type, payload);
  }

  sendToMarketSubscribers(marketId: string, type: WsEventType, payload: unknown): void {
    const subscribers = this.marketSubscribers.get(marketId);
    if (!subscribers) return;

    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString(),
    } satisfies WsMessage);

    for (const clientId of subscribers) {
      const client = this.clients.get(clientId);
      if (client?.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  sendToUser(userId: string, type: WsEventType, payload: unknown): void {
    const message = JSON.stringify({
      type,
      payload,
      timestamp: new Date().toISOString(),
    } satisfies WsMessage);

    for (const client of this.clients.values()) {
      if (client.userId === userId && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  private sendToClient(clientId: string, type: WsEventType, payload: unknown): void {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) return;

    client.ws.send(
      JSON.stringify({
        type,
        payload,
        timestamp: new Date().toISOString(),
      } satisfies WsMessage)
    );
  }

  // ─────────────────────────────────────────────────────────────────
  // REDIS PUB/SUB (for multi-instance horizontal scaling)
  // ─────────────────────────────────────────────────────────────────

  private async setupRedisPubSub(): Promise<void> {
    // ioredis auto-connects unless `lazyConnect: true` is used.
    // We explicitly connect below, so ensure we don't connect twice.
    const subscriber = redisClient.duplicate({ lazyConnect: true });
    await subscriber.connect();

    // Handle all pub/sub messages via the `pmessage` event.
    // `psubscribe(pattern, callback)`'s callback is subscription confirmation (err, count),
    // not the per-message payload handler.
    subscriber.on('pmessage', (_pattern: string, channel: string, message: string) => {
      try {
        if (channel.startsWith('market:')) {
          const marketId = channel.slice('market:'.length);
          const parsed = JSON.parse(message);
          this.sendToMarketSubscribers(marketId, parsed.type, parsed.payload);
          return;
        }

        if (channel.startsWith('user:')) {
          const userId = channel.slice('user:'.length);
          const parsed = JSON.parse(message);
          this.sendToUser(userId, parsed.type, parsed.payload);
          return;
        }
      } catch (err) {
        logger.warn('Failed to parse Redis pub/sub message', { channel });
      }
    });

    await subscriber.psubscribe('market:*', 'user:*');

    logger.info('Redis pub/sub subscribed');
  }

  getStats() {
    return {
      connectedClients: this.clients.size,
      authenticatedClients: [...this.clients.values()].filter((c) => c.userId).length,
      marketSubscriptions: this.marketSubscribers.size,
    };
  }

  shutdown(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    for (const client of this.clients.values()) {
      client.ws.close(1001, 'Server shutting down');
    }
    this.wss?.close();
  }
}
