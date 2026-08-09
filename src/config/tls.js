import tls from 'tls';

/**
 * Corporate antivirus / SSL inspection on Windows often injects a local root CA.
 * Node's default Mozilla store does not include it, so outbound HTTPS (Sumsub,
 * etc.) fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE.
 *
 * Prefer `node --use-system-ca`, but also merge system CAs here so plain
 * `node src/index.js` still works on Node 22+.
 */
export function trustSystemCertificates() {
  if (typeof tls.getCACertificates !== 'function' || typeof tls.setDefaultCACertificates !== 'function') {
    return false;
  }

  try {
    const defaults = tls.getCACertificates('default');
    const system = tls.getCACertificates('system');
    tls.setDefaultCACertificates([...defaults, ...system]);
    return true;
  } catch (err) {
    console.warn('TLS: could not merge system CA store:', err?.message || err);
    return false;
  }
}
