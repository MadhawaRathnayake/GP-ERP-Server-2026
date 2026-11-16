import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live quotations. After every committed insert or update of a Quotation row, from any writer, its notify_quotation_change
// trigger (migration 20261116100000_quotation_change_events) sends the quotation's id on this channel, and db-events passes
// it on. Clients then reload just those rows (GET /api/v1/quotations/by-ids). Postgres doesn't store notifications: the
// ones sent while this server was disconnected are covered by the stream's `resync` (modules/events).
export const QUOTATION_CHANGE_CHANNEL = "quotation_change"

const log = logger.child({ module: "quotations" })

/** Calls `onChange` with the id of every quotation that changes. Returns a function that stops watching. */
export async function watchQuotationChanges(onChange: (id: number) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== QUOTATION_CHANGE_CHANNEL) return
    const id = parseQuotationChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid quotation_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(QUOTATION_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the quotation id as text), or null if it isn't one. */
export function parseQuotationChange(payload: string): number | null {
  if (!/^[1-9]\d*$/.test(payload)) return null
  const id = Number(payload)
  return Number.isSafeInteger(id) ? id : null
}
