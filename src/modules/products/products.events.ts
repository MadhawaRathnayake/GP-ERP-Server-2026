import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live products. After every committed insert or update of a Product row, from any writer, its trigger (migration
// 20261116120000_master_data_change_events) sends the id on this channel, and db-events passes it on. Stock-only
// changes don't: live stock (modules/stock) carries those. Clients then reload just those rows (GET
// /api/v1/products/by-ids). Postgres doesn't store notifications: the ones sent while this server was disconnected are
// covered by the stream's `resync` (modules/events).
export const PRODUCT_CHANGE_CHANNEL = "product_change"

const log = logger.child({ module: "products" })

/** Calls `onChange` with the id of every product that changes. Returns a function that stops watching. */
export async function watchProductChanges(onChange: (id: string) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== PRODUCT_CHANGE_CHANNEL) return
    const id = parseProductChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid product_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(PRODUCT_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the product id), or null if it isn't one. */
export function parseProductChange(payload: string): string | null {
  return /^PROD\d{6,}$/.test(payload) ? payload : null
}
