import { body } from 'express-validator';
import { ALLOWED_COUNTRY_CODES } from '../config/env.js';
import { ALLOWED_DIAL_CODES, normalizeDialCode } from '../utils/phone.js';
import * as authService from '../services/auth.service.js';
import { rotateRefreshToken } from '../services/token.service.js';
import { asyncHandler } from '../utils/errors.js';

const phoneFieldsValidator = body().custom((_, { req }) => {
  const { dialCode, phoneNumber, phone } = req.body;
  const hasParts =
    dialCode != null &&
    String(dialCode).trim() !== '' &&
    phoneNumber != null &&
    String(phoneNumber).trim() !== '';
  const hasFull = phone != null && String(phone).trim() !== '';

  if (!hasParts && !hasFull) {
    throw new Error('Enter a valid phone number');
  }

  if (hasParts) {
    const code = normalizeDialCode(dialCode);
    if (!ALLOWED_DIAL_CODES.includes(code)) {
      throw new Error('Invalid country dial code');
    }
    const national = String(phoneNumber).replace(/\D/g, '').replace(/^0+/, '');
    if (national.length < 6 || national.length > 15) {
      throw new Error('Enter a valid phone number');
    }
  } else if (String(phone).replace(/\s/g, '').length < 8) {
    throw new Error('Enter a valid phone number');
  }

  return true;
});

export const registerValidators = [
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Enter a valid email address'),
  phoneFieldsValidator,
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
  body('countryCode')
    .isIn(ALLOWED_COUNTRY_CODES)
    .withMessage('Invalid country code'),
  body('acceptedTerms')
    .custom((value) => value === true)
    .withMessage('You must accept the Terms & Privacy Policy'),
];

export const loginValidators = [
  body('email').isEmail().withMessage('Enter a valid email address'),
  body('password').notEmpty().withMessage('Password is required'),
];

export const forgotPasswordValidators = [
  body('contact').trim().notEmpty().withMessage('Contact is required'),
  body('method')
    .isIn(['email', 'phone', 'whatsapp'])
    .withMessage('Method must be email, phone, or whatsapp'),
];

export const verifyOtpValidators = [
  body('contact').trim().notEmpty().withMessage('Contact is required'),
  body('method')
    .isIn(['email', 'phone', 'whatsapp'])
    .withMessage('Method must be email, phone, or whatsapp'),
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Enter the 6-digit code'),
];

export const loginOtpSendValidators = [
  body('contact').trim().notEmpty().withMessage('Contact is required'),
  body('method')
    .isIn(['email', 'phone', 'whatsapp'])
    .withMessage('Method must be email, phone, or whatsapp'),
];

export const loginOtpVerifyValidators = [
  body('contact').trim().notEmpty().withMessage('Contact is required'),
  body('method')
    .isIn(['email', 'phone', 'whatsapp'])
    .withMessage('Method must be email, phone, or whatsapp'),
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Enter the 6-digit code'),
];

export const verifyContactSendValidators = [
  body('method')
    .isIn(['email', 'phone', 'whatsapp'])
    .withMessage('Method must be email, phone, or whatsapp'),
];

export const verifyContactVerifyValidators = [
  body('method')
    .isIn(['email', 'phone', 'whatsapp'])
    .withMessage('Method must be email, phone, or whatsapp'),
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Enter the 6-digit code'),
];

export const verifyEmailValidators = [
  body('code')
    .isLength({ min: 6, max: 6 })
    .withMessage('Enter the 6-digit code'),
];

export const resetPasswordValidators = [
  body('resetToken').notEmpty().withMessage('Reset token is required'),
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

export const changePasswordValidators = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters'),
];

export const verifyPasswordValidators = [
  body('password').notEmpty().withMessage('Password is required'),
];

export const updateRoleValidators = [
  body('role')
    .isIn(['sender', 'traveler', 'receiver'])
    .withMessage('Role must be sender, traveler, or receiver'),
];

export const updateProfileValidators = [
  body('name').trim().notEmpty().withMessage('Full name is required'),
  body('email').isEmail().withMessage('Enter a valid email address'),
  phoneFieldsValidator,
  body('countryCode')
    .isIn(ALLOWED_COUNTRY_CODES)
    .withMessage('Invalid country code'),
];

export const register = asyncHandler(async (req, res) => {
  const result = await authService.registerUser(req.body);
  res.status(201).json({ success: true, data: result });
});

export const login = asyncHandler(async (req, res) => {
  const result = await authService.loginUser(req.body);
  res.json({ success: true, data: result });
});

export const me = asyncHandler(async (req, res) => {
  const user = await authService.getUserProfile(req.user.id);
  res.json({ success: true, data: { user } });
});

export const updateProfile = asyncHandler(async (req, res) => {
  const result = await authService.updateUserProfile(req.user.id, req.body);
  res.json({ success: true, data: result });
});

export const logout = asyncHandler(async (req, res) => {
  await authService.logoutUser(req.body.refreshToken);
  res.json({ success: true, data: { message: 'Logged out' } });
});

export const refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) {
    return res.status(400).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Refresh token is required' },
    });
  }

  const result = await rotateRefreshToken(refreshToken);
  const user = await authService.getUserProfile(result.userId);

  res.json({
    success: true,
    data: {
      user,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
    },
  });
});

export const forgotPassword = asyncHandler(async (req, res) => {
  const result = await authService.sendPasswordResetOtp(req.body);
  res.json({ success: true, data: result });
});

export const verifyOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyPasswordResetOtp(req.body);
  res.json({ success: true, data: result });
});

export const resetPassword = asyncHandler(async (req, res) => {
  const result = await authService.resetPassword(req.body);
  res.json({ success: true, data: result });
});

export const changePassword = asyncHandler(async (req, res) => {
  const result = await authService.changePassword(req.user.id, {
    currentPassword: req.body.currentPassword,
    newPassword: req.body.newPassword,
  });
  res.json({ success: true, data: result });
});

export const verifyPassword = asyncHandler(async (req, res) => {
  const result = await authService.verifyUserPassword(req.user.id, req.body.password);
  res.json({ success: true, data: result });
});

export const sendLoginOtp = asyncHandler(async (req, res) => {
  const result = await authService.sendLoginOtp(req.body);
  res.json({ success: true, data: result });
});

export const verifyLoginOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyLoginOtp(req.body);
  res.json({ success: true, data: result });
});

export const sendCrossVerificationOtp = asyncHandler(async (req, res) => {
  const result = await authService.sendCrossVerificationOtp(req.user.id, req.body);
  res.json({ success: true, data: result });
});

export const verifyCrossVerificationOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyCrossVerificationOtp(req.user.id, req.body);
  res.json({ success: true, data: result });
});

export const sendEmailVerificationOtp = asyncHandler(async (req, res) => {
  const result = await authService.sendEmailVerificationOtp(req.user.id);
  res.json({ success: true, data: result });
});

export const verifyEmailVerificationOtp = asyncHandler(async (req, res) => {
  const result = await authService.verifyEmailVerificationOtp(req.user.id, req.body);
  res.json({ success: true, data: result });
});

export const updateRole = asyncHandler(async (req, res) => {
  const result = await authService.updateUserRole(req.user.id, req.body);
  res.json({ success: true, data: result });
});
