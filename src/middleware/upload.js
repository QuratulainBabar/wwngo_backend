import multer from 'multer';
import { AppError } from '../utils/errors.js';

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

const storage = multer.memoryStorage();

function fileFilter(_req, file, cb) {
  if (!ALLOWED_MIME.has(file.mimetype)) {
    return cb(new AppError('Only image uploads are allowed (JPEG, PNG, WebP, HEIC)', 400, 'VALIDATION_ERROR'));
  }
  cb(null, true);
}

export const deliveryPhotosUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 3,
  },
}).array('photos', 3);

export function handleMulterError(err, _req, _res, next) {
  if (!err) return next();

  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new AppError('Each image must be 10 MB or smaller', 400, 'VALIDATION_ERROR'));
    }
    if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new AppError('Upload between 1 and 3 parcel photos', 400, 'VALIDATION_ERROR'));
    }
    return next(new AppError(err.message, 400, 'VALIDATION_ERROR'));
  }

  next(err);
}
