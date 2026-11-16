import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"

// Live GRNs. After every committed insert or update of a GoodsReceivedNote row, from any writer, its trigger (migration
// 20261116110000_document_change_events) sends the id on this channel, and db-events passes it on. A delivery
// (GoodsReceivedNoteDelivery) announces its GRN too, since the list row shows the deliveries. Clients then reload just
// those rows (GET /api/v1/goods-received-notes/by-ids). Postgres doesn't store notifications: the ones sent while this
// server was disconnected are covered by the stream's `resync` (modules/events).
export const GOODS_RECEIVED_NOTE_CHANGE_CHANNEL = "goods_received_note_change"

const log = logger.child({ module: "goods-received-notes" })

/** Calls `onChange` with the id of every GRN that changes. Returns a function that stops watching. */
export async function watchGoodsReceivedNoteChanges(onChange: (id: number) => void): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== GOODS_RECEIVED_NOTE_CHANGE_CHANNEL) return
    const id = parseGoodsReceivedNoteChange(payload)
    if (id !== null) onChange(id)
    else log.error({ payload }, "ignored an invalid goods_received_note_change notification")
  }

  dbEvents.on("notification", onNotification)
  await listenTo(GOODS_RECEIVED_NOTE_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
  }
}

/** The trigger's payload (the GRN id as text), or null if it isn't one. */
export function parseGoodsReceivedNoteChange(payload: string): number | null {
  if (!/^[1-9]\d*$/.test(payload)) return null
  const id = Number(payload)
  return Number.isSafeInteger(id) ? id : null
}
