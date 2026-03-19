import client from 'prom-client';

// Enable default metrics (CPU, memory, etc.)
client.collectDefaultMetrics({ prefix: 'pm_' });

// ─────────────────────────────────────────────────────────────────
// CUSTOM METRICS
// ─────────────────────────────────────────────────────────────────

export const httpRequestDuration = new client.Histogram({
  name: 'pm_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
});

export const httpRequestsTotal = new client.Counter({
  name: 'pm_http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status_code'],
});

export const tradeCounter = new client.Counter({
  name: 'pm_trades_total',
  help: 'Total number of trades executed',
  labelNames: ['side', 'action'],
});

export const tradeVolume = new client.Counter({
  name: 'pm_trade_volume_total',
  help: 'Total trading volume in USD',
});

export const activeMarketsGauge = new client.Gauge({
  name: 'pm_active_markets',
  help: 'Number of currently active markets',
});

export const connectedWebSocketClients = new client.Gauge({
  name: 'pm_websocket_clients',
  help: 'Number of connected WebSocket clients',
});

export const orderBookDepth = new client.Gauge({
  name: 'pm_order_book_depth',
  help: 'Number of open orders per market',
  labelNames: ['market_id', 'side'],
});

export const databaseQueryDuration = new client.Histogram({
  name: 'pm_db_query_duration_seconds',
  help: 'Database query duration',
  labelNames: ['query_type'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1],
});

export const cacheHitCounter = new client.Counter({
  name: 'pm_cache_hits_total',
  help: 'Cache hit/miss statistics',
  labelNames: ['namespace', 'result'],
});

export const registeredUsersGauge = new client.Gauge({
  name: 'pm_registered_users',
  help: 'Total number of registered users',
});

// Metrics middleware
export function metricsMiddleware() {
  return (req: any, res: any, next: any) => {
    const start = Date.now();

    res.on('finish', () => {
      const duration = (Date.now() - start) / 1000;
      const route = req.route?.path ?? req.path ?? 'unknown';
      const labels = {
        method: req.method,
        route: route,
        status_code: String(res.statusCode),
      };

      httpRequestDuration.observe(labels, duration);
      httpRequestsTotal.inc(labels);
    });

    next();
  };
}

export async function getMetrics(): Promise<string> {
  return client.register.metrics();
}

export function getContentType(): string {
  return client.register.contentType;
}
