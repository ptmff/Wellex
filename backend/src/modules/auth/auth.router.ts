import { Router, Request, Response } from 'express';
import { AuthService } from './auth.service';
import { authenticate } from '../../common/guards';

const router = Router();
const authService = new AuthService();

// POST /api/v1/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const result = await authService.register(req.body);
  res.status(201).json({ success: true, data: result });
});

// POST /api/v1/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const result = await authService.login(req.body, req.ip);
  res.json({ success: true, data: result });
});

// POST /api/v1/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'refreshToken required' } });
  }
  const result = await authService.refreshToken(refreshToken);
  res.json({ success: true, data: result });
});

// POST /api/v1/auth/logout
router.post('/logout', authenticate(), async (req: Request, res: Response) => {
  await authService.logout(req.user!.id, req.body.refreshToken);
  res.json({ success: true, data: { message: 'Logged out successfully' } });
});

// GET /api/v1/auth/me
router.get('/me', authenticate(), async (req: Request, res: Response) => {
  res.json({ success: true, data: req.user });
});

export { router as authRouter };
