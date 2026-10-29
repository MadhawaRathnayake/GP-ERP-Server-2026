import { Redis } from "ioredis"
import { env } from "#config/env.js"
import { logger } from "./logger.js"

// The Redis client (cache + sessions). Connects at boot via platform/core/connections.plugin.ts.
// While disconnected, commands fail at once instead of queueing, so callers fall back to the database without waiting.
export const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1, enableOfflineQueue: false })

redis.on("error", (err) => logger.warn({ err }, "redis error"))
