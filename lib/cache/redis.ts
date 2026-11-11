/**
 * Tiny JSON cache over the Upstash Redis REST API (plain fetch, no client
 * dependency). Falls back to a per-process Map when Upstash is not configured
 * so local dev works without Redis. Cache failures never fail a request.
 */

const REST_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/+$/, '');
const REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const memory = new Map<string, { value: string; expiresAt: number }>();
const MEMORY_MAX_ENTRIES = 500;

async function command<T>(args: (string | number)[]): Promise<T | null> {
  const res = await fetch(REST_URL!, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${REST_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
    cache: 'no-store',
    signal: AbortSignal.timeout(2000),
  });
  if (!res.ok) throw new Error(`Upstash responded ${res.status}`);
  const data = (await res.json()) as { result: T | null };
  return data.result;
}

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    let raw: string | null;
    if (REST_URL && REST_TOKEN) {
      raw = await command<string>(['GET', key]);
    } else {
      const hit = memory.get(key);
      if (hit && hit.expiresAt <= Date.now()) memory.delete(key);
      raw = hit && hit.expiresAt > Date.now() ? hit.value : null;
    }
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (err) {
    console.warn('[cache] get failed:', err);
    return null;
  }
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number,
): Promise<void> {
  try {
    const raw = JSON.stringify(value);
    if (REST_URL && REST_TOKEN) {
      await command(['SET', key, raw, 'EX', ttlSeconds]);
      return;
    }
    if (memory.size >= MEMORY_MAX_ENTRIES) {
      const oldest = memory.keys().next().value;
      if (oldest !== undefined) memory.delete(oldest);
    }
    memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  } catch (err) {
    console.warn('[cache] set failed:', err);
  }
}
