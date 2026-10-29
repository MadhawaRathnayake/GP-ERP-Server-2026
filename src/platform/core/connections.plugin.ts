import fp from "fastify-plugin"
import { db } from "./db.js"
import { redis } from "./redis.js"

// Opens the Postgres and Redis connections at boot and closes them on shutdown.
// Postgres is required (fail fast). Redis is only a cache, so the app starts without it and the client keeps retrying.
// Code uses them through plain imports: platform/core/db.ts, platform/core/redis.ts.
export default fp(
  async (app) => {
    await db.$connect()
    await redis.connect().catch((err) => app.log.warn({ err }, "redis unavailable, using the database until it's back"))
    app.addHook("onClose", async () => {
      await Promise.all([db.$disconnect(), redis.quit().catch(() => redis.disconnect())])
    })
  },
  { name: "connections" },
)
