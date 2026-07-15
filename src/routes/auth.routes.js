import { Router } from 'express';
import * as authController from '../controllers/auth.controller.js';
import { authenticate, validate } from '../middleware/auth.js';

const router = Router();

router.post('/register', authController.registerValidators, validate, authController.register);
router.post('/login', authController.loginValidators, validate, authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', authController.logout);
router.get('/me', authenticate, authController.me);
router.patch(
  '/profile',
  authenticate,
  authController.updateProfileValidators,
  validate,
  authController.updateProfile
);
router.post(
  '/role',
  authenticate,
  authController.updateRoleValidators,
  validate,
  authController.updateRole
);

router.post(
  '/forgot-password',
  authController.forgotPasswordValidators,
  validate,
  authController.forgotPassword
);
router.post(
  '/verify-otp',
  authController.verifyOtpValidators,
  validate,
  authController.verifyOtp
);
router.post(
  '/reset-password',
  authController.resetPasswordValidators,
  validate,
  authController.resetPassword
);

router.post(
  '/change-password',
  authenticate,
  authController.changePasswordValidators,
  validate,
  authController.changePassword
);
router.post(
  '/verify-password',
  authenticate,
  authController.verifyPasswordValidators,
  validate,
  authController.verifyPassword
);

router.post(
  '/login/otp/send',
  authController.loginOtpSendValidators,
  validate,
  authController.sendLoginOtp
);
router.post(
  '/login/otp/verify',
  authController.loginOtpVerifyValidators,
  validate,
  authController.verifyLoginOtp
);

router.post(
  '/verify-email/send',
  authenticate,
  authController.sendEmailVerificationOtp
);
router.post(
  '/verify-email/verify',
  authenticate,
  authController.verifyEmailValidators,
  validate,
  authController.verifyEmailVerificationOtp
);

router.post(
  '/verify-contact/send',
  authenticate,
  authController.verifyContactSendValidators,
  validate,
  authController.sendCrossVerificationOtp
);
router.post(
  '/verify-contact/verify',
  authenticate,
  authController.verifyContactVerifyValidators,
  validate,
  authController.verifyCrossVerificationOtp
);

export default router;
