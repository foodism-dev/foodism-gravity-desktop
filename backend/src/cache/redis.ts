import { createClient } from "redis";
import type { KeyValueCache } from "./key-value.ts";

interface RedisStringClient {
  isOpen: boolean;
  connect: () => Promise<unknown>;
  get: (key: string) => Promise<string | null>;
  setEx: (key: string, seconds: number, value: string) => Promise<unknown>;
  del: (key: string) => Promise<unknown>;
  on: (event: "error", listener: (error: unknown) => void) => unknown;
}

let redisClientPromise: Promise<RedisStringClient | null> | null = null;
let redisCache: KeyValueCache | null | undefined;

function readRedisUrl(): string | null {
  const value = Bun.env.REDIS_URL?.trim();
  return value || null;
}

async function getRedisClient(): Promise<RedisStringClient | null> {
  if (redisClientPromise) {
    return redisClientPromise;
  }

  const redisUrl = readRedisUrl();
  if (!redisUrl) {
    redisClientPromise = Promise.resolve(null);
    return redisClientPromise;
  }

  redisClientPromise = (async () => {
    const client = createClient({ url: redisUrl }) as RedisStringClient;
    client.on("error", (error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[Redis] 连接异常: ${message}`);
    });
    if (!client.isOpen) {
      await client.connect();
    }
    return client;
  })().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[Redis] 初始化失败，使用内存缓存: ${message}`);
    return null;
  });

  return redisClientPromise;
}

export function getRedisKeyValueCache(): KeyValueCache | null {
  if (redisCache !== undefined) {
    return redisCache;
  }

  if (!readRedisUrl()) {
    redisCache = null;
    return redisCache;
  }

  redisCache = {
    async get(key: string): Promise<string | null> {
      const client = await getRedisClient();
      return client ? await client.get(key) : null;
    },

    async set(key: string, value: string, ttlSeconds: number): Promise<void> {
      const client = await getRedisClient();
      if (client) {
        await client.setEx(key, ttlSeconds, value);
      }
    },

    async del(key: string): Promise<void> {
      const client = await getRedisClient();
      if (client) {
        await client.del(key);
      }
    },
  };
  return redisCache;
}
