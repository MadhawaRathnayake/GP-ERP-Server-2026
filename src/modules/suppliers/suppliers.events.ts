import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live suppliers. After every committed insert or update of a Supplier row, from any writer, its trigger (migration
// 20261116120000_master_data_change_events) sends the id on this channel, and db-events passes it on. Clients then
// reload just those rows (GET /api/v1/suppliers/by-ids). Postgres doesn't store notifications: the ones sent while this
// server was disconnected are covered by the stream's `resync` (modules/events).
export const SUPPLIER_CHANGE_CHANNEL = "supplier_change"

const log = logger.child({ module: "suppliers" })

/** Calls `onChange` with the id of every supplier that changes. Returns a function that stops watching. */
export async function watchSupplierChanges(onChange: (id: string) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== SUPPLIER_CHANGE_CHANNEL) return
    const id = parseSupplierChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid supplier_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(SUPPLIER_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the supplier id), or null if it isn't one. */
export function parseSupplierChange(payload: string): string | null {
  return /^SUP\d{5,}$/.test(payload) ? payload : null
}
