export interface RateLimitRecord {
  count: number;
  resetAt: number;
}

export function pruneRateLimits(
  rateLimits: Map<string, RateLimitRecord>,
  now = Date.now()
): string[] {
  const prunedKeys: string[] = [];
  for (const [key, value] of rateLimits.entries()) {
    if (value.resetAt <= now) {
      rateLimits.delete(key);
      prunedKeys.push(key);
    }
  }
  return prunedKeys;
}

export function consumeRateLimit(
  rateLimits: Map<string, RateLimitRecord>,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now()
): boolean {
  const existing = rateLimits.get(key);
  const current =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };
  current.count += 1;
  rateLimits.set(key, current);
  return current.count <= limit;
}

export function createOriginMatcher(allowedOrigins: string[], production: boolean) {
  return (origin: string | undefined): boolean => {
    if (!origin) {
      return true;
    }
    if (allowedOrigins.includes(origin)) {
      return true;
    }
    return !production && allowedOrigins.length === 0;
  };
}

export function resolveRelayFullAccessSetting(
  explicit: boolean | undefined,
  env: Record<string, string | undefined> = process.env
): boolean {
  if (explicit !== undefined) {
    return explicit;
  }
  if (env.CODEXNEXT_DISABLE_RELAY_FULL_ACCESS === "1") {
    return false;
  }
  return true;
}
