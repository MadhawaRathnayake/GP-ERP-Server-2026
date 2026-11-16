import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live delivery notes. After every committed insert or update of a DeliveryNote row, from any writer, its trigger
// (migration 20261116110000_document_change_events) sends the id on this channel, and db-events passes it on. Clients
// then reload just those rows (GET /api/v1/delivery-notes/by-ids). Postgres doesn't store notifications: the ones sent
// while this server was disconnected are covered by the stream's `resync` (modules/events).
export const DELIVERY_NOTE_CHANGE_CHANNEL = "delivery_note_change"

const log = logger.child({ module: "delivery-notes" })

/** Calls `onChange` with the id of every delivery note that changes. Returns a function that stops watching. */
export async function watchDeliveryNoteChanges(onChange: (id: number) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== DELIVERY_NOTE_CHANGE_CHANNEL) return
    const id = parseDeliveryNoteChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid delivery_note_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(DELIVERY_NOTE_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the delivery note id as text), or null if it isn't one. */
export function parseDeliveryNoteChange(payload: string): number | null {
  if (!/^[1-9]\d*$/.test(payload)) return null
  const id = Number(payload)
  return Number.isSafeInteger(id) ? id : null
}
