import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live purchase orders. After every committed insert or update of a PurchaseOrder row, from any writer, its trigger
// (migration 20261116110000_document_change_events) sends the id on this channel, and db-events passes it on. Clients
// then reload just those rows (GET /api/v1/purchase-orders/by-ids). Postgres doesn't store notifications: the ones sent
// while this server was disconnected are covered by the stream's `resync` (modules/events).
export const PURCHASE_ORDER_CHANGE_CHANNEL = "purchase_order_change"

const log = logger.child({ module: "purchase-orders" })

/** Calls `onChange` with the id of every purchase order that changes. Returns a function that stops watching. */
export async function watchPurchaseOrderChanges(onChange: (id: number) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== PURCHASE_ORDER_CHANGE_CHANNEL) return
    const id = parsePurchaseOrderChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid purchase_order_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(PURCHASE_ORDER_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the purchase order id as text), or null if it isn't one. */
export function parsePurchaseOrderChange(payload: string): number | null {
  if (!/^[1-9]\d*$/.test(payload)) return null
  const id = Number(payload)
  return Number.isSafeInteger(id) ? id : null
}
