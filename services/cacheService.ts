import { getRedisClient, isRedisReady } from '../providers/redis';
import { config } from '../config';

type MemoryEntry = {
  value: string;
  expiresAt?: number;
};

const memoryStore = new Map<string, MemoryEntry>();

const memoryGet = (key: string) => {
  const entry = memoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt && entry.expiresAt < Date.now()) {
    memoryStore.delete(key);
    return null;
  }
  return entry.value;
};

const memorySet = (key: string, value: string, ttlSeconds?: number) => {
  const expiresAt = ttlSeconds && ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : undefined;
  memoryStore.set(key, { value, expiresAt });
};

const memoryDel = (key: string) => {
  memoryStore.delete(key);
};

// JSON helpers with Redis or in-memory fallback
export const cacheGetJSON = async <T = any>(key: string): Promise<T | null> => {
  if (isRedisReady()) {
    try {
      const client = getRedisClient();
      const raw = await client!.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      // fall through to memory
    }
  }

  const raw = memoryGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
};

export const cacheSetJSON = async (key: string, value: any, ttlSeconds = config.cacheTtlSeconds) => {
  const serialized = JSON.stringify(value);
  if (isRedisReady()) {
    try {
      const client = getRedisClient()!;
      if (ttlSeconds > 0) {
        await client.set(key, serialized, 'EX', ttlSeconds);
      } else {
        await client.set(key, serialized);
      }
      return;
    } catch {
      // fallback to memory
    }
  }
  memorySet(key, serialized, ttlSeconds);
};

export const cacheDel = async (key: string) => {
  if (isRedisReady()) {
    try {
      await getRedisClient()!.del(key);
    } catch {
      // ignore and fall back
    }
  }
  memoryDel(key);
};

export default getRedisClient;
