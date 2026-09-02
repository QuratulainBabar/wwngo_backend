// Prefer the native `bcrypt` binding: it is faster than pure-JS `bcryptjs` and,
// crucially, runs on the libuv threadpool instead of blocking Node's single
// event-loop thread — so one login no longer stalls every other in-flight
// request. Falls back to `bcryptjs` if the native module isn't installed/built,
// so the server still boots. Hash format is identical, so the two are fully
// interoperable (existing hashes verify either way).
let bcrypt;
try {
  bcrypt = (await import('bcrypt')).default;
} catch {
  console.warn('[perf] native bcrypt unavailable — falling back to bcryptjs (slower, blocks event loop)');
  bcrypt = (await import('bcryptjs')).default;
}

const ROUNDS = 12;

/** Strip autofill newlines; never treat a non-string as a password. */
export function normalizePasswordInput(password) {
  if (typeof password !== 'string') return '';
  return password.replace(/\r?\n/g, '');
}

function hashToString(hash) {
  if (typeof hash === 'string') return hash.trim();
  if (Buffer.isBuffer(hash)) return hash.toString('utf8').trim();
  return '';
}

export async function hashPassword(password) {
  return bcrypt.hash(normalizePasswordInput(password), ROUNDS);
}

export async function verifyPassword(password, hash) {
  const normalized = normalizePasswordInput(password);
  const hashStr = hashToString(hash);
  if (!normalized || !hashStr) return false;
  try {
    return await bcrypt.compare(normalized, hashStr);
  } catch {
    return false;
  }
}

export async function hashToken(token) {
  return bcrypt.hash(token, ROUNDS);
}

export async function verifyTokenHash(token, hash) {
  return bcrypt.compare(token, hash);
}
