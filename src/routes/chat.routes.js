import { Router } from 'express';
import * as chatController from '../controllers/chat.controller.js';
import { authenticate } from '../middleware/auth.js';
import { chatImageUpload, handleMulterError } from '../middleware/upload.js';

const router = Router();

router.get('/', authenticate, chatController.listConversations);
router.get('/:id', authenticate, chatController.getConversation);
router.post('/:id/messages', authenticate, chatController.sendMessage);
router.post(
  '/:id/messages/image',
  authenticate,
  (req, res, next) => {
    chatImageUpload(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  chatController.sendImageMessage
);

export default router;
