import { Router } from 'express';
import { query } from 'express-validator';
import * as notificationController from '../controllers/notification.controller.js';
import { authenticate, validate } from '../middleware/auth.js';

const router = Router();

const roleQuery = query('role')
  .isIn(['sender', 'traveler', 'receiver'])
  .withMessage('role must be sender, traveler, or receiver');

router.get('/', authenticate, roleQuery, validate, notificationController.listNotifications);
router.get('/unread-count', authenticate, roleQuery, validate, notificationController.unreadCount);
router.patch('/:id/read', authenticate, notificationController.markRead);
router.post('/mark-all-read', authenticate, notificationController.markAllRead);

export default router;
