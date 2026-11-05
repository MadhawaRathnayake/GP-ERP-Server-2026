import { dbEvents, listenTo } from "#cache/db-events.plugin.js"
import { logger } from "#core/logger.js"
import { stockLevel, type StockLevel } from "./stock.schema.js"

// Live stock. After every committed stock change, Product's notify_stock_change trigger (migration
// 20261105090000_product_stock_version) sends the product's new stock on this channel, and db-events passes it on.
// Postgres doesn't store notifications: any sent while this server was disconnected are lost, so watchers hear
// `onMissed` after a reconnect and clients reload GET /api/v1/stock.
export const STOCK_CHANGE_CHANNEL = "stock_change"

const log = logger.child({ module: "stock" })

export interface StockWatcher {
  onChange(level: StockLevel): void
  /** Changes may have been missed: whoever shows stock should reload it. */
  onMissed(): void
}

/** Calls `watcher` for every stock change, from any writer. Returns a function that stops watching. */
export async function watchStockChanges(watcher: StockWatcher): Promise<() => void> {
  const onNotification = (channel: string, payload: string) => {
    if (channel !== STOCK_CHANGE_CHANNEL) return
    const level = parseStockChange(payload)
    if (level) watcher.onChange(level)
    else log.error({ payload }, "ignored an invalid stock_change notification")
  }
  const onReconnect = () => watcher.onMissed()

  dbEvents.on("notification", onNotification)
  dbEvents.on("reconnect", onReconnect)
  await listenTo(STOCK_CHANGE_CHANNEL)
  return () => {
    dbEvents.off("notification", onNotification)
    dbEvents.off("reconnect", onReconnect)
  }
}

/** The trigger's JSON payload, or null if it isn't a valid stock level. */
export function parseStockChange(payload: string): StockLevel | null {
  try {
    const result = stockLevel.safeParse(JSON.parse(payload))
    return result.success ? result.data : null
  } catch {
    return null
  }
}
