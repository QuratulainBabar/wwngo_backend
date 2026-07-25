import * as chatService from '../services/chat.service.js';
import { asyncHandler } from '../utils/errors.js';

export const listConversations = asyncHandler(async (req, res) => {
  const data = await chatService.listConversations(req.user.id);
  res.json({ success: true, data: { conversations: data } });
});

export const getConversation = asyncHandler(async (req, res) => {
  const data = await chatService.getConversation(req.user.id, req.params.id);
  res.json({ success: true, data });
});

export const sendMessage = asyncHandler(async (req, res) => {
  const data = await chatService.sendMessage(
    req.user.id,
    req.params.id,
    req.body?.text ?? req.body?.body
  );
  res.status(201).json({ success: true, data });
});
