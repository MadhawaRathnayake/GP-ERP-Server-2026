import { describe, expect, it } from "vitest"
import { z } from "zod"
import { parseStockChange } from "./stock.events.js"
import { stockLevel } from "./stock.schema.js"

// The payload notify_stock_change() builds with json_build_object (migration 20261105090000_product_stock_version).
const payload = {
  id: "PROD000001",
  stockInHand: 4,
  stockPreOrder: 0,
  stockInTransit: 10,
  stockOnArrival: 2,
  stockVersion: 1042,
}

describe("parseStockChange", () => {
  it("reads the trigger's payload and gives it back unchanged when encoded for clients", () => {
    const level = parseStockChange(JSON.stringify(payload))
    expect(level).toEqual({ ...payload, stockVersion: 1042n })
    expect(z.encode(stockLevel, level!)).toEqual(payload)
  })

  it.each([
    ["not JSON", "PROD000001"],
    ["a missing field", JSON.stringify({ ...payload, stockInHand: undefined })],
    ["a fractional stock", JSON.stringify({ ...payload, stockInHand: 1.5 })],
    ["a negative version", JSON.stringify({ ...payload, stockVersion: -1 })],
  ])("rejects %s", (_, text) => {
    expect(parseStockChange(text)).toBeNull()
  })
})
