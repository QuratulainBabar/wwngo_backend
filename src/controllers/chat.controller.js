import * as chatService from '../services/chat.service.js';
import { asyncHandler } from '../utils/errors.js';

export const listConversations = asyncHandler(async (req, res) => {
  const threadType = req.query.threadType || null;
  const data = await chatService.listConversations(req.user.id, { threadType });
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
    req.body
  );
  res.status(201).json({ success: true, data });
});

export const sendImageMessage = asyncHandler(async (req, res) => {
  const data = await chatService.sendImageMessage(req.user.id, req.params.id, req.file);
  res.status(201).json({ success: true, data });
});
