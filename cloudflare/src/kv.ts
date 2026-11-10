import { UserSession } from "./types";

const SESSION_PREFIX = "sess:";
const CACHE_PREFIX = "cache:";

export async function getUserSession(kv: KVNamespace, telegramId: number): Promise<UserSession | null> {
  const data = await kv.get(`${SESSION_PREFIX}${telegramId}`, "json");
  return (data as UserSession) || null;
}

export async function setUserSession(
  kv: KVNamespace,
  telegramId: number,
  session: UserSession,
  ttlSeconds: number = 600
): Promise<void> {
  await kv.put(`${SESSION_PREFIX}${telegramId}`, JSON.stringify(session), {
    expirationTtl: ttlSeconds,
  });
}

export async function clearUserSession(kv: KVNamespace, telegramId: number): Promise<void> {
  await kv.delete(`${SESSION_PREFIX}${telegramId}`);
}

export async function getCached<T>(kv: KVNamespace, key: string): Promise<T | null> {
  try {
    const data = await kv.get(`${CACHE_PREFIX}${key}`, "json");
    return (data as T) || null;
  } catch {
    return null;
  }
}

export async function setCached<T>(
  kv: KVNamespace,
  key: string,
  value: T,
  ttlSeconds: number = 300
): Promise<void> {
  try {
    await kv.put(`${CACHE_PREFIX}${key}`, JSON.stringify(value), {
      expirationTtl: ttlSeconds,
    });
  } catch {
    // Ignore cache write errors
  }
}
