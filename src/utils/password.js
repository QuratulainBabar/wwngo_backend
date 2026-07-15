import bcrypt from 'bcryptjs';

const ROUNDS = 12;

export async function hashPassword(password) {
  return bcrypt.hash(password, ROUNDS);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export async function hashToken(token) {
  return bcrypt.hash(token, ROUNDS);
}

export async function verifyTokenHash(token, hash) {
  return bcrypt.compare(token, hash);
}
