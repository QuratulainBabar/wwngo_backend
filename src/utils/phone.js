/** Common international dial codes (must stay aligned with Flutter PhoneCountries). */
export const ALLOWED_DIAL_CODES = [
  '+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33', '+34', '+36', '+39',
  '+40', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+52', '+54',
  '+55', '+56', '+57', '+60', '+61', '+62', '+63', '+64', '+65', '+66', '+81',
  '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94', '+212', '+213',
  '+216', '+218', '+221', '+222', '+223', '+224', '+225', '+226', '+227',
  '+228', '+229', '+231', '+233', '+234', '+237', '+243', '+251', '+254',
  '+255', '+256', '+258', '+260', '+263', '+351', '+353', '+355', '+358',
  '+380', '+381', '+385', '+420', '+852', '+880', '+961', '+962', '+965',
  '+966', '+968', '+971', '+972', '+974',
];

export function normalizeDialCode(dialCode) {
  if (dialCode == null) return '';
  const digits = String(dialCode).replace(/[^\d]/g, '');
  return digits ? `+${digits}` : '';
}

export function normalizeNationalNumber(phoneNumber) {
  if (phoneNumber == null) return '';
  // Drop leading zeros commonly typed after selecting a dial code.
  return String(phoneNumber).replace(/\D/g, '').replace(/^0+/, '');
}

export function normalizePhone(phone) {
  if (phone == null) return '';
  const trimmed = String(phone).trim();
  if (!trimmed) return '';
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  return hasPlus || digits.length > 10 ? `+${digits}` : digits;
}

/**
 * Builds a compact E.164-style phone from dial code + national number,
 * or normalizes a legacy full `phone` string.
 */
export function buildInternationalPhone({ dialCode, phoneNumber, phone } = {}) {
  const code = normalizeDialCode(dialCode);
  const national = normalizeNationalNumber(phoneNumber);

  if (code && national) {
    return {
      dialCode: code,
      phoneNumber: national,
      phone: `${code}${national}`,
    };
  }

  const full = normalizePhone(phone);
  if (!full.startsWith('+')) {
    return { dialCode: '', phoneNumber: full, phone: full };
  }

  // Longest matching dial-code prefix.
  let matched = '';
  for (const allowed of ALLOWED_DIAL_CODES) {
    if (full.startsWith(allowed) && allowed.length > matched.length) {
      matched = allowed;
    }
  }

  if (!matched) {
    return { dialCode: '', phoneNumber: full.slice(1), phone: full };
  }

  return {
    dialCode: matched,
    phoneNumber: full.slice(matched.length),
    phone: full,
  };
}

export function assertValidInternationalPhone({ dialCode, phoneNumber, phone } = {}) {
  const built = buildInternationalPhone({ dialCode, phoneNumber, phone });

  if (dialCode != null && dialCode !== '' && !ALLOWED_DIAL_CODES.includes(built.dialCode)) {
    const err = new Error('Invalid country dial code');
    err.status = 400;
    err.code = 'INVALID_DIAL_CODE';
    throw err;
  }

  if (!built.phone || !built.phone.startsWith('+')) {
    const err = new Error('Enter a valid international phone number');
    err.status = 400;
    err.code = 'INVALID_PHONE';
    throw err;
  }

  if (built.phoneNumber.length < 6 || built.phoneNumber.length > 15) {
    const err = new Error('Enter a valid phone number');
    err.status = 400;
    err.code = 'INVALID_PHONE';
    throw err;
  }

  // E.164 max length is 15 digits excluding '+'.
  if (built.phone.replace(/\D/g, '').length > 15) {
    const err = new Error('Enter a valid phone number');
    err.status = 400;
    err.code = 'INVALID_PHONE';
    throw err;
  }

  return built;
}
