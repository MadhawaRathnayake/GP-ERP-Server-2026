import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live customers. After every committed insert or update of a Customer row, from any writer, its trigger (migration
// 20261116120000_master_data_change_events) sends the id on this channel, and db-events passes it on. Clients then
// reload just those rows (GET /api/v1/customers/by-ids). Postgres doesn't store notifications: the ones sent while this
// server was disconnected are covered by the stream's `resync` (modules/events).
export const CUSTOMER_CHANGE_CHANNEL = "customer_change"

const log = logger.child({ module: "customers" })

/** Calls `onChange` with the id of every customer that changes. Returns a function that stops watching. */
export async function watchCustomerChanges(onChange: (id: string) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== CUSTOMER_CHANGE_CHANNEL) return
    const id = parseCustomerChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid customer_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(CUSTOMER_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the customer id), or null if it isn't one. */
export function parseCustomerChange(payload: string): string | null {
  return /^CUST\d{6,}$/.test(payload) ? payload : null
}
