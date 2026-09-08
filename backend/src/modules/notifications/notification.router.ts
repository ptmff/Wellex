import { Router, Request, Response } from 'express';
import { authenticate } from '../../common/guards';
import type { NotificationService } from './notification.service';

const router = Router();

function svc(req: Request): NotificationService {
  return req.app.locals.notificationService as NotificationService;
}

router.get('/', authenticate(), async (req: Request, res: Response) => {
  const data = await svc(req).list(req.user!.id);
  res.json({ success: true, data });
});

router.post('/read-all', authenticate(), async (req: Request, res: Response) => {
  const data = await svc(req).markAllRead(req.user!.id);
  res.json({ success: true, data });
});

router.post('/:id/read', authenticate(), async (req: Request, res: Response) => {
  const data = await svc(req).markRead(req.user!.id, req.params.id);
  res.json({ success: true, data });
});

export { router as notificationRouter };
