import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/requirements.js';
import * as adminService from '../services/admin.service.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.use(authenticate, requireAdmin);

router.get('/stats', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: await adminService.dashboardStats() });
}));

router.get('/users', asyncHandler(async (req, res) => {
  const users = await adminService.listUsers({
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
  });
  res.json({ success: true, data: { users } });
}));

router.get('/users/:id', asyncHandler(async (req, res) => {
  const detail = await adminService.getUserDetail(req.params.id);
  res.json({ success: true, data: detail });
}));

router.patch('/users/:id', asyncHandler(async (req, res) => {
  const user = await adminService.updateUser(req.params.id, req.body || {}, {
    actorId: req.user.id,
  });
  res.json({ success: true, data: { user } });
}));

router.post('/users/:id/test-notification', asyncHandler(async (req, res) => {
  const result = await adminService.sendTestNotification(req.params.id, {
    title: req.body?.title,
    body: req.body?.body,
    role: req.body?.role,
  });
  res.json({ success: true, data: result });
}));

router.get('/deliveries', asyncHandler(async (req, res) => {
  const deliveries = await adminService.listDeliveries({
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
    status: req.query.status || null,
    filter: req.query.filter || null,
  });
  res.json({ success: true, data: { deliveries } });
}));

router.get('/deliveries/:id', asyncHandler(async (req, res) => {
  const delivery = await adminService.getDeliveryById(req.params.id);
  res.json({ success: true, data: { delivery } });
}));

router.post('/users/:id/suspend', asyncHandler(async (req, res) => {
  const user = await adminService.suspendUser(req.params.id, { suspend: true });
  res.json({ success: true, data: { user } });
}));

router.post('/users/:id/unsuspend', asyncHandler(async (req, res) => {
  const user = await adminService.suspendUser(req.params.id, { suspend: false });
  res.json({ success: true, data: { user } });
}));

router.get('/escrows', asyncHandler(async (req, res) => {
  const escrows = await adminService.listEscrows({
    limit: Number(req.query.limit) || 50,
    status: req.query.status || null,
  });
  res.json({ success: true, data: { escrows } });
}));

router.post('/escrows/:shipmentId/refund', asyncHandler(async (req, res) => {
  const result = await adminService.adminRefundEscrow(
    req.params.shipmentId,
    req.body?.reason,
  );
  res.json({ success: true, data: result });
}));

router.get('/nfc-audit', asyncHandler(async (req, res) => {
  const logs = await adminService.listNfcAudit({
    limit: Number(req.query.limit) || 100,
    fraudOnly: req.query.fraudOnly === 'true',
  });
  res.json({ success: true, data: { logs } });
}));

router.get('/trips', asyncHandler(async (req, res) => {
  const trips = await adminService.listTrips({
    limit: Number(req.query.limit) || 50,
    offset: Number(req.query.offset) || 0,
    status: req.query.status || null,
  });
  res.json({ success: true, data: { trips } });
}));

router.get('/trips/:id', asyncHandler(async (req, res) => {
  const trip = await adminService.getTripById(req.params.id);
  res.json({ success: true, data: { trip } });
}));

router.post('/trips/:id/cancel', asyncHandler(async (req, res) => {
  const trip = await adminService.cancelTrip(req.params.id, {
    reason: req.body?.reason,
  });
  res.json({ success: true, data: { trip } });
}));

router.get('/disputes', asyncHandler(async (req, res) => {
  const disputes = await adminService.listDisputes({
    status: req.query.status || null,
    limit: Number(req.query.limit) || 50,
  });
  res.json({ success: true, data: { disputes } });
}));

router.post('/disputes/:id/resolve', asyncHandler(async (req, res) => {
  const dispute = await adminService.resolveDispute(req.params.id, req.user.id, {
    resolution: req.body.resolution,
    dismiss: req.body.dismiss === true,
    closeAs: req.body.closeAs || null,
  });
  res.json({ success: true, data: { dispute } });
}));

router.post('/bans', asyncHandler(async (req, res) => {
  const entry = await adminService.addBanEntry({
    banType: req.body.banType,
    valueHash: req.body.valueHash,
    reason: req.body.reason,
    createdBy: req.user.id,
  });
  res.json({ success: true, data: { entry } });
}));

router.post('/clear-data', asyncHandler(async (req, res) => {
  const result = await adminService.clearOperationalData({
    actorId: req.user.id,
  });
  res.json({ success: true, data: result });
}));

export default router;
