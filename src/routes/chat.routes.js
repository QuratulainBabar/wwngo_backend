import { Router } from 'express';
import * as chatController from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/', authenticate, chatController.listConversations);
router.get('/:id', authenticate, chatController.getConversation);
router.post('/:id/messages', authenticate, chatController.sendMessage);

export default router;
