import { Router } from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/', authenticate, tripController.createTrip);
router.get('/discover', authenticate, tripController.discoverTrips);
router.get('/discover/:id', authenticate, tripController.getDiscoverableTrip);
router.get(
  '/sender-requests/count',
  authenticate,
  tripController.countSenderRequests
);
router.get('/sender-requests', authenticate, tripController.listSenderRequests);
router.post(
  '/sender-requests/:requestId/counter-offers',
  authenticate,
  tripController.createCounterOffer
);
router.get(
  '/sender-requests/:requestId',
  authenticate,
  tripController.getSenderRequest
);
router.get('/counter-offers', authenticate, tripController.listCounterOffers);
router.get(
  '/counter-offers/:offerId',
  authenticate,
  tripController.getCounterOffer
);
router.get(
  '/sender-request-trips',
  authenticate,
  tripController.listSenderRequestTrips
);
router.get(
  '/:id/sender-requests',
  authenticate,
  tripController.listSenderRequestsForTrip
);
router.post(
  '/:id/sender-requests/read',
  authenticate,
  tripController.markSenderRequestsRead
);
router.get('/', authenticate, tripController.listTrips);
router.post('/:id/cancel', authenticate, tripController.cancelTrip);
router.patch('/:id', authenticate, tripController.updateTrip);
router.get('/:id', authenticate, tripController.getTrip);

export default router;
