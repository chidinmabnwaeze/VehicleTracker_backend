const env = require("./env");

// Small JSON key/value store for live trip state.
// Uses Redis when REDIS_URL is set, otherwise falls back to process memory.
let client = null;
const memory = new Map();

if (env.redisUrl) {
  const Redis = require("ioredis");
  client = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  client.on("connect", () => console.log("[redis] connected"));
  client.on("error", (err) => console.error("[redis]", err.message));
} else {
  console.warn(
    "[redis] REDIS_URL not set - keeping live trip state in memory (single instance only)",
  );
}

async function getJSON(key) {
  if (client) {
    const raw = await client.get(key);
    return raw ? JSON.parse(raw) : null;
  }
  const entry = memory.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt <= Date.now()) {
    memory.delete(key);
    return null;
  }
  return JSON.parse(entry.raw);
}

async function setJSON(key, value, ttlSeconds) {
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

async function del(key) {
  if (client) await client.del(key);
  else memory.delete(key);
}

async function disconnect() {
  if (client) await client.quit();
}

module.exports = { getJSON, setJSON, del, disconnect };
