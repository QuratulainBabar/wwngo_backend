import { Router } from 'express';
import * as placesController from '../controllers/places.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.get('/autocomplete', authenticate, placesController.autocomplete);
router.get('/details', authenticate, placesController.details);

export default router;
