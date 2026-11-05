import { EventEmitter } from "node:events"
import fp from "fastify-plugin"
import pg from "pg"
import { env } from "#config/env.js"
import { cache } from "./cache.js"

// Keeps the cache in sync with the database, and passes on the other Postgres notifications modules ask for.
// Every table has a notify_change trigger (added by `npm run db:migrate`) that sends the table name on channel
// `db_change` after each committed write — from Prisma, raw SQL, psql or another service. This plugin LISTENs on a
// dedicated connection and invalidates the cache entries built from that table.
//
//   dbEvents.on("change", (table) => ...)    fires after the cache for `table` was invalidated
//   await listenTo("stock_change")           also LISTEN on a module's own channel, on the same connection
//   dbEvents.on("notification", (channel, payload) => ...)    a message on such a channel
//   dbEvents.on("reconnect", () => ...)      the connection was lost and is back. Postgres doesn't store
//                                            notifications, so any sent meanwhile are gone: reload what depends on them

export const DB_CHANGE_CHANNEL = "db_change"

export const dbEvents = new EventEmitter<{
  change: [table: string]
  notification: [channel: string, payload: string]
  reconnect: []
}>()

// Every channel to LISTEN on, now and after each reconnect.
const channels = new Set([DB_CHANGE_CHANNEL])
let client: pg.Client | undefined

/** Also LISTEN on `channel`; its messages arrive as dbEvents "notification". Safe to call before the plugin connects. */
export async function listenTo(channel: string): Promise<void> {
  if (channels.has(channel)) return
  channels.add(channel)
  await client?.query(`LISTEN ${client.escapeIdentifier(channel)}`)
}

export default fp(
  async (app) => {
    const log = app.log.child({ module: "db-events" })
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
        if (!msg.payload) return
        if (msg.channel === DB_CHANGE_CHANNEL) void onChange(msg.payload)
        else dbEvents.emit("notification", msg.channel, msg.payload)
      })
      next.on("error", (err) => {
        log.error({ err }, "lost connection")
        scheduleReconnect()
      })
      try {
        await next.connect()
        // Iterating the set also covers a channel that listenTo() adds while this loop waits.
        for (const channel of channels) await next.query(`LISTEN ${next.escapeIdentifier(channel)}`)
      } catch (err) {
        await next.end().catch(() => {})
        throw err
      }
      client = next
      retryMs = 1000
      log.info({ channels: [...channels] }, "listening for db changes")
      if (isReconnect) {
        // Changes made while disconnected were missed: drop the whole cache, then tell the listeners.
        await cache.invalidateAll().catch((err) => log.error({ err }, "cache reset failed"))
        dbEvents.emit("reconnect")
      }
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
      const old = client
      client = undefined
      await old?.end()
    })
  },
  { name: "db-events", dependencies: ["connections"] },
)
