import { Router } from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/', authenticate, tripController.createTrip);
router.get('/', authenticate, tripController.listTrips);
router.get('/:id', authenticate, tripController.getTrip);

export default router;
