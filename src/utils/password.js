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
