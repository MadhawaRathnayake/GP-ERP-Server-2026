import { EventEmitter } from "node:events"
import fp from "fastify-plugin"
import pg from "pg"
import { env } from "#config/env.js"
import { cache } from "./cache.js"

// Keeps the cache in sync with the database.
// Every table has a notify_change trigger (added by `npm run db:migrate`) that sends the table name on channel
// `db_change` after each committed write — from Prisma, raw SQL, psql or another service. This plugin LISTENs on a
// dedicated connection and invalidates the cache entries built from that table.
//
//   dbEvents.on("change", (table) => ...)   fires after the cache for `table` was invalidated

export const DB_CHANGE_CHANNEL = "db_change"

export const dbEvents = new EventEmitter<{ change: [table: string] }>()

export default fp(
  async (app) => {
    const log = app.log.child({ module: "db-events" })
    let client: pg.Client | undefined
    let closing = false
    let retryMs = 1000

    const onChange = async (table: string) => {
      log.debug({ table }, "db change")
      await cache.invalidate(table).catch((err) => log.error({ err, table }, "cache invalidation failed"))
      dbEvents.emit("change", table)
    }

    const connect = async (isReconnect: boolean) => {
      const next = new pg.Client({ connectionString: env.DATABASE_URL })
      next.on("notification", (msg) => {
        if (msg.channel === DB_CHANGE_CHANNEL && msg.payload) void onChange(msg.payload)
      })
      next.on("error", (err) => {
        log.error({ err }, "lost connection")
        scheduleReconnect()
      })
      try {
        await next.connect()
        await next.query(`LISTEN ${DB_CHANGE_CHANNEL}`)
      } catch (err) {
        await next.end().catch(() => {})
        throw err
      }
      client = next
      retryMs = 1000
      log.info("listening for db changes")
      // Changes made while disconnected were missed: drop the whole cache.
      if (isReconnect) await cache.invalidateAll().catch((err) => log.error({ err }, "cache reset failed"))
    }

    const scheduleReconnect = () => {
      if (closing) return
      const old = client
      client = undefined
      void old?.end().catch(() => {})
      setTimeout(() => {
        connect(true).catch((err) => {
          log.error({ err, retryMs }, "reconnect failed")
          retryMs = Math.min(retryMs * 2, 30_000)
          scheduleReconnect()
        })
      }, retryMs).unref()
    }

    await connect(false)

    app.addHook("onClose", async () => {
      closing = true
      await client?.end()
    })
  },
  { name: "db-events", dependencies: ["connections"] },
)
