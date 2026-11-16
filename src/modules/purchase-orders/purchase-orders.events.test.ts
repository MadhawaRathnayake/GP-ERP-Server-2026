import { describe, expect, it } from "vitest"
import { parsePurchaseOrderChange } from "./purchase-orders.events.js"

// notify_document_change() sends NEW."id"::text (migration 20261116110000_document_change_events).
describe("parsePurchaseOrderChange", () => {
  it("reads the trigger's payload", () => {
    expect(parsePurchaseOrderChange("28041")).toBe(28041)
  })

  it.each([
    ["empty", ""],
    ["not a number", "GPPO-0001"],
    ["zero", "0"],
    ["negative", "-3"],
    ["fractional", "1.5"],
    ["JSON", JSON.stringify({ id: 1 })],
    ["too large", "99999999999999999999"],
  ])("rejects %s", (_, text) => {
    expect(parsePurchaseOrderChange(text)).toBeNull()
  })
})
