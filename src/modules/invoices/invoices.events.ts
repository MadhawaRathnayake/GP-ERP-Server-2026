import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live invoices. After every committed insert or update of an Invoice row, from any writer, its notify_invoice_change
// trigger (migration 20261116090000_invoice_change_events) sends the invoice's id on this channel, and db-events passes
// it on. Clients then reload just those rows (GET /api/v1/invoices/by-ids). Postgres doesn't store notifications: the
// ones sent while this server was disconnected are covered by the stream's `resync` (modules/events).
export const INVOICE_CHANGE_CHANNEL = "invoice_change"

const log = logger.child({ module: "invoices" })

/** Calls `onChange` with the id of every invoice that changes. Returns a function that stops watching. */
export async function watchInvoiceChanges(onChange: (id: number) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== INVOICE_CHANGE_CHANNEL) return
    const id = parseInvoiceChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid invoice_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(INVOICE_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the invoice id as text), or null if it isn't one. */
export function parseInvoiceChange(payload: string): number | null {
  if (!/^[1-9]\d*$/.test(payload)) return null
  const id = Number(payload)
  return Number.isSafeInteger(id) ? id : null
}
