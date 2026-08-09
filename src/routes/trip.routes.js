import { Router } from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireKycApproved, requireWalletMinimum, requireFullyVerified } from '../middleware/requirements.js';

const router = Router();

router.post('/', authenticate, requireKycApproved, requireWalletMinimum('traveler'), tripController.createTrip);
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
  requireKycApproved,
  tripController.createCounterOffer
);
router.get(
  '/sender-requests/:requestId',
  authenticate,
  tripController.getSenderRequest
);
router.post(
  '/sender-requests/:requestId/accept',
  authenticate,
  requireKycApproved,
  requireWalletMinimum('traveler'),
  tripController.acceptSenderRequest
);
router.post(
  '/sender-requests/:requestId/decline',
  authenticate,
  tripController.declineSenderRequest
);
router.get('/counter-offers', authenticate, tripController.listCounterOffers);
router.get(
  '/counter-offers/:offerId',
  authenticate,
  tripController.getCounterOffer
);
router.get(
  '/sender-counter-offers/by-delivery/:deliveryPublicId',
  authenticate,
  tripController.getSenderCounterOfferByDelivery
);
router.get(
  '/sender-counter-offers/:offerId',
  authenticate,
  tripController.getSenderCounterOffer
);
router.post(
  '/sender-counter-offers/:offerId/accept',
  authenticate,
  requireKycApproved,
  requireFullyVerified,
  tripController.acceptSenderCounterOffer
);
router.post(
  '/sender-counter-offers/:offerId/reject',
  authenticate,
  tripController.rejectSenderCounterOffer
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
