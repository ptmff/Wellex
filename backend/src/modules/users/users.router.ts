import { Router, Request, Response } from 'express';
import { UsersService } from './users.service';
import { authenticate } from '../../common/guards';

const usersService = new UsersService();

const router = Router();

// GET /api/v1/users/leaderboard
router.get('/leaderboard', async (req: Request, res: Response) => {
  const type = (req.query.type as 'volume' | 'pnl' | 'trades') ?? 'volume';
  const limit = Math.min(parseInt(String(req.query.limit ?? 20)), 100);
  const data = await usersService.getLeaderboard(type, limit);
  res.json({ success: true, data });
});

// GET /api/v1/users/search?q=alice
router.get('/search', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '');
  const data = await usersService.searchUsers(q);
  res.json({ success: true, data });
});

// GET /api/v1/users/me
router.get('/me', authenticate(), async (req: Request, res: Response) => {
  const profile = await usersService.getProfile(req.user!.username);
  res.json({ success: true, data: profile });
});

// PATCH /api/v1/users/me
router.patch('/me', authenticate(), async (req: Request, res: Response) => {
  const updated = await usersService.updateProfile(req.user!.id, req.body);
  res.json({ success: true, data: updated });
});

// PATCH /api/v1/users/me/username
router.patch('/me/username', authenticate(), async (req: Request, res: Response) => {
  const updated = await usersService.changeUsername(req.user!.id, req.body);
  res.json({ success: true, data: updated });
});

// GET /api/v1/users/:username
router.get('/:username', async (req: Request, res: Response) => {
  const profile = await usersService.getProfile(req.params.username);
  res.json({ success: true, data: profile });
});

export { router as usersRouter };
