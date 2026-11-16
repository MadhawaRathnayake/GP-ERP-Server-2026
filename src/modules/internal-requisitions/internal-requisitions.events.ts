import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live internal requisitions. After every committed insert or update of a InternalRequisition row, from any writer, its
// trigger (migration 20261116110000_document_change_events) sends the id on this channel, and db-events passes it on.
// Clients then reload just those rows (GET /api/v1/internal-requisitions/by-ids). Postgres doesn't store notifications:
// the ones sent while this server was disconnected are covered by the stream's `resync` (modules/events).
export const INTERNAL_REQUISITION_CHANGE_CHANNEL = "internal_requisition_change"

const log = logger.child({ module: "internal-requisitions" })

/** Calls `onChange` with the id of every internal requisition that changes. Returns a function that stops watching. */
export async function watchInternalRequisitionChanges(onChange: (id: number) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== INTERNAL_REQUISITION_CHANGE_CHANNEL) return
    const id = parseInternalRequisitionChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid internal_requisition_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(INTERNAL_REQUISITION_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the internal requisition id as text), or null if it isn't one. */
export function parseInternalRequisitionChange(payload: string): number | null {
  if (!/^[1-9]\d*$/.test(payload)) return null
  const id = Number(payload)
  return Number.isSafeInteger(id) ? id : null
}
