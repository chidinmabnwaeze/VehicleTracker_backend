import { Redis } from "ioredis";
import { env } from "./env";

// Small JSON key/value store for live trip state.
// Uses Redis when REDIS_URL is set, otherwise falls back to process memory.
let client: Redis | null = null;
const memory = new Map<string, { raw: string; expiresAt: number | null }>();

if (env.redisUrl) {
  client = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  client.on("connect", () => console.log("[redis] connected"));
  client.on("error", (err: Error) => console.error("[redis]", err.message));
} else {
  console.warn(
    "[redis] REDIS_URL not set - keeping live trip state in memory (single instance only)",
  );
}

export async function getJSON<T>(key: string): Promise<T | null> {
  if (client) {
    const raw = await client.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return JSON.parse(entry.raw) as T;
}

export async function setJSON(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
  const raw = JSON.stringify(value);
  if (client) {
    if (ttlSeconds) await client.set(key, raw, "EX", ttlSeconds);
    else await client.set(key, raw);
    return;
  }
  memory.set(key, {
    raw,
    expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
  });
}

export async function del(key: string): Promise<void> {
  if (client) await client.del(key);
  else memory.delete(key);
}

export async function disconnect(): Promise<void> {
  if (client) await client.quit();
}
