import { Router } from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/', authenticate, tripController.createTrip);
router.get('/discover', authenticate, tripController.discoverTrips);
router.get('/discover/:id', authenticate, tripController.getDiscoverableTrip);
router.get('/', authenticate, tripController.listTrips);
router.post('/:id/cancel', authenticate, tripController.cancelTrip);
router.patch('/:id', authenticate, tripController.updateTrip);
router.get('/:id', authenticate, tripController.getTrip);

export default router;
