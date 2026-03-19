import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { db } from '../../database/connection';
import { authenticate, requireRole } from '../../common/guards';
import { marketCache, userCache } from '../../infrastructure/redis/cache.service';
import { logger } from '../../common/logger';

const router = Router();

// All admin routes require auth + admin/moderator role
router.use(authenticate(), requireRole('moderator', 'admin'));

const ResolveMarketDto = z.object({
  outcome: z.enum(['yes', 'no', 'invalid']),
  note: z.string().max(1000).optional(),
});

// GET /api/v1/admin/markets?status=pending
router.get('/markets', async (req: Request, res: Response) => {
  const status = req.query.status ?? 'pending';
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 20), 100);

  const [markets, total] = await Promise.all([
    db('markets as m')
      .leftJoin('users as u', 'm.creator_id', 'u.id')
      .where('m.status', status)
      .orderBy('m.created_at', 'desc')
      .limit(limit)
      .offset((page - 1) * limit)
      .select('m.*', 'u.username as creator_username'),
    db('markets').where('status', status).count('* as count').first(),
  ]);

  res.json({
    success: true,
    data: {
      data: markets,
      total: parseInt(String((total as any)?.count ?? 0), 10),
      page,
      limit,
    },
  });
});

// POST /api/v1/admin/markets/:id/resolve
router.post('/markets/:id/resolve', async (req: Request, res: Response) => {
  const validated = ResolveMarketDto.parse(req.body);
  const engine = req.app.locals.lmsrEngine;

  const result = await engine.resolveMarket(
    req.params.id,
    validated.outcome,
    req.user!.id,
    validated.note
  );

  await marketCache.del(`market:${req.params.id}`);
  await marketCache.delPattern('list:*');

  logger.info('Admin resolved market', {
    marketId: req.params.id,
    outcome: validated.outcome,
    adminId: req.user!.id,
    ...result,
  });

  res.json({ success: true, data: result });
});

// PATCH /api/v1/admin/markets/:id/feature
router.patch('/markets/:id/feature', requireRole('admin'), async (req: Request, res: Response) => {
  const { featured } = req.body;
  await db('markets').where('id', req.params.id).update({ is_featured: Boolean(featured) });
  await marketCache.del(`market:${req.params.id}`);
  res.json({ success: true, data: { featured } });
});

// GET /api/v1/admin/users
router.get('/users', requireRole('admin'), async (req: Request, res: Response) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const search = req.query.search as string | undefined;

  let q = db('users').orderBy('created_at', 'desc');
  if (search) {
    q = q.where((b) => b.whereLike('email', `%${search}%`).orWhereLike('username', `%${search}%`));
  }

  const [users, total] = await Promise.all([
    q.clone().limit(limit).offset((page - 1) * limit)
      .select('id', 'email', 'username', 'display_name', 'role', 'status', 'created_at', 'last_login_at'),
    q.clone().count('* as count').first(),
  ]);

  res.json({
    success: true,
    data: {
      data: users,
      total: parseInt(String((total as any)?.count ?? 0), 10),
      page,
      limit,
    },
  });
});

// PATCH /api/v1/admin/users/:id/status
router.patch('/users/:id/status', requireRole('admin'), async (req: Request, res: Response) => {
  const { status } = z.object({
    status: z.enum(['active', 'suspended', 'banned']),
  }).parse(req.body);

  await db('users').where('id', req.params.id).update({ status, updated_at: new Date() });
  await userCache.del(`user:${req.params.id}`);

  logger.info('Admin updated user status', {
    targetUserId: req.params.id,
    status,
    adminId: req.user!.id,
  });

  res.json({ success: true, data: { status } });
});

// GET /api/v1/admin/reports
router.get('/reports', async (req: Request, res: Response) => {
  const reports = await db('market_reports as r')
    .join('markets as m', 'r.market_id', 'm.id')
    .join('users as u', 'r.reporter_id', 'u.id')
    .where('r.status', req.query.status ?? 'pending')
    .orderBy('r.created_at', 'desc')
    .limit(50)
    .select('r.*', 'm.title as market_title', 'u.username as reporter_username');

  res.json({ success: true, data: reports });
});

// PATCH /api/v1/admin/reports/:id
router.patch('/reports/:id', async (req: Request, res: Response) => {
  const { status, note } = z.object({
    status: z.enum(['reviewed', 'dismissed']),
    note: z.string().max(500).optional(),
  }).parse(req.body);

  await db('market_reports').where('id', req.params.id).update({
    status,
    review_note: note,
    reviewer_id: req.user!.id,
    reviewed_at: new Date(),
    updated_at: new Date(),
  });

  res.json({ success: true, data: { status } });
});

// GET /api/v1/admin/stats
router.get('/stats', requireRole('admin'), async (req: Request, res: Response) => {
  const analytics = req.app.locals.analyticsService;
  const metrics = await analytics.getPlatformMetrics();

  const wsStats = req.app.locals.wsService?.getStats() ?? {};

  res.json({
    success: true,
    data: {
      platform: metrics,
      websocket: wsStats,
    },
  });
});

export { router as adminRouter };
