/** International dial codes aligned with Flutter `CountryDialCodes.byIso`. */
export const ALLOWED_DIAL_CODES = [
  '+1', '+7', '+20', '+27', '+30', '+31', '+32', '+33', '+34', '+36', '+39',
  '+40', '+41', '+43', '+44', '+45', '+46', '+47', '+48', '+49', '+51', '+52',
  '+53', '+54', '+55', '+56', '+57', '+58', '+60', '+61', '+62', '+63', '+64',
  '+65', '+66', '+81', '+82', '+84', '+86', '+90', '+91', '+92', '+93', '+94',
  '+95', '+98', '+211', '+212', '+213', '+216', '+218', '+220', '+221', '+222',
  '+223', '+224', '+225', '+226', '+227', '+228', '+229', '+230', '+231', '+232',
  '+233', '+234', '+235', '+236', '+237', '+238', '+239', '+240', '+241', '+242',
  '+243', '+244', '+245', '+248', '+249', '+250', '+251', '+252', '+253', '+254',
  '+255', '+256', '+257', '+258', '+260', '+261', '+263', '+264', '+265', '+266',
  '+267', '+268', '+269', '+291', '+351', '+352', '+353', '+354', '+355', '+356',
  '+357', '+358', '+359', '+370', '+371', '+372', '+373', '+374', '+375', '+376',
  '+377', '+378', '+379', '+380', '+381', '+382', '+385', '+386', '+387', '+389',
  '+420', '+421', '+423', '+501', '+502', '+503', '+504', '+505', '+506', '+507',
  '+509', '+591', '+592', '+593', '+595', '+597', '+598', '+670', '+673', '+674',
  '+675', '+676', '+677', '+678', '+679', '+680', '+685', '+686', '+688', '+691',
  '+692', '+850', '+852', '+853', '+855', '+856', '+880', '+886', '+960', '+961',
  '+962', '+963', '+964', '+965', '+966', '+967', '+968', '+970', '+971', '+972',
  '+973', '+974', '+975', '+976', '+977', '+992', '+993', '+994', '+995', '+996',
  '+998', '+1242', '+1246', '+1268', '+1473', '+1758', '+1767', '+1784', '+1809',
  '+1868', '+1869', '+1876',
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
