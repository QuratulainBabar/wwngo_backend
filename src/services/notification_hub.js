/**
 * In-memory SSE fan-out for authenticated notification streams.
 * Clients subscribe per user + role; new notifications are pushed instantly.
 */

/** @type {Map<string, Set<import('http').ServerResponse>>} */
const clientsByKey = new Map();

function streamKey(userId, role) {
  return `${userId}:${role}`;
}

/**
 * @param {string} userId
 * @param {'sender'|'traveler'|'receiver'} role
 * @param {import('http').ServerResponse} res
 * @returns {() => void}
 */
export function subscribe(userId, role, res) {
  const key = streamKey(userId, role);
  let set = clientsByKey.get(key);
  if (!set) {
    set = new Set();
    clientsByKey.set(key, set);
  }
  set.add(res);

  return () => {
    const current = clientsByKey.get(key);
    if (!current) return;
    current.delete(res);
    if (current.size === 0) clientsByKey.delete(key);
  };
}

/**
 * @param {string} userId
 * @param {'sender'|'traveler'|'receiver'} role
 * @param {object} payload
 */
export function publish(userId, role, payload) {
  const key = streamKey(userId, role);
  const set = clientsByKey.get(key);
  if (!set || set.size === 0) return;

  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch {
      set.delete(res);
    }
  }
  if (set.size === 0) clientsByKey.delete(key);
}
