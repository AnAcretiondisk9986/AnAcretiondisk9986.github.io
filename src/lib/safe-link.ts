/** Return only navigable HTTP(S) or same-site relative links. */
export function safeLink(value: unknown, fallback = ''): string {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  if ((raw.startsWith('/') && !raw.startsWith('//')) || raw.startsWith('#') || raw.startsWith('?')) {
    return raw;
  }
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : fallback;
  } catch {
    return fallback;
  }
}
