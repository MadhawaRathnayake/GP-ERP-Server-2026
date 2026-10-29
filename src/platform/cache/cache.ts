import type { Redis } from "ioredis"
import type { Logger } from "pino"
import { env } from "#config/env.js"
import { logger } from "#core/logger.js"
import { redis } from "#core/redis.js"

// Redis cache keyed by the DB tables the data comes from.
//
// Every key embeds the current version of its tables (e.g. "Product@7"). When Postgres reports a write to a table,
// platform/cache/db-events.plugin.ts calls invalidate("Product"), which bumps the version: every cached list page, filter and item
// built from that table becomes unreachable at once and expires through its TTL. No key scanning.
//
// Most code never calls this directly — add `config: { cache: ["Product"] }` to a GET route instead (platform/cache/route-cache.plugin.ts).
// Use remember() for data needed outside a route (e.g. settings, the logged-in user). It stores JSON, so return
// JSON-safe values (strings instead of Dates/Decimals).

const versionKey = (table: string) => `cache:ver:${table}`
const GLOBAL = "*" // bumped by invalidateAll(); part of every key

export interface RememberOptions {
  tables: string[]
  key: string
  ttl?: number
}

export class Cache {
  constructor(
    private readonly redis: Redis,
    private readonly log: Logger,
    private readonly defaultTtl: number,
  ) {}

  /** Full Redis key for `key`, stamped with the current versions of `tables`. */
  async keyFor(tables: string[], key: string): Promise<string> {
    const all = [GLOBAL, ...tables]
    const versions = await this.redis.mget(all.map(versionKey))
    return `cache:${all.map((t, i) => `${t}@${versions[i] ?? 0}`).join(",")}:${key}`
  }

  get(fullKey: string): Promise<string | null> {
    return this.redis.get(fullKey)
  }

  async set(fullKey: string, value: string, ttl = this.defaultTtl): Promise<void> {
    await this.redis.set(fullKey, value, "EX", ttl)
  }

  async remember<T>({ tables, key, ttl }: RememberOptions, load: () => Promise<T>): Promise<T> {
    let fullKey: string
    try {
      fullKey = await this.keyFor(tables, key)
      const hit = await this.get(fullKey)
      if (hit !== null) {
        this.log.debug({ cacheKey: fullKey }, "cache hit")
        return JSON.parse(hit) as T
      }
    } catch (err) {
      // Redis down must not take the API down: fall through to the database.
      this.log.warn({ err }, "cache read failed, loading from database")
      return load()
    }

    this.log.debug({ cacheKey: fullKey }, "cache miss")
    const value = await load()
    await this.set(fullKey, JSON.stringify(value), ttl).catch((err) => this.log.warn({ err }, "cache write failed"))
    return value
  }

  async invalidate(...tables: string[]): Promise<void> {
    if (tables.length === 0) return
    const pipeline = this.redis.pipeline()
    for (const table of tables) pipeline.incr(versionKey(table))
    await pipeline.exec()
    this.log.debug({ tables }, "cache invalidated")
  }

  invalidateAll(): Promise<void> {
    return this.invalidate(GLOBAL)
  }
}

export const cache = new Cache(redis, logger.child({ module: "cache" }), env.CACHE_TTL_SECONDS)
